-- #240 Slice B2: exact-revision accept, decline and counter for first-class transfer offers.

begin;

alter table public.transfer_deal_events
  drop constraint if exists transfer_deal_events_event_type_check;
alter table public.transfer_deal_events
  add constraint transfer_deal_events_event_type_check
  check (event_type in ('offered', 'withdrawn', 'accepted', 'declined', 'countered'));

create or replace function public.respond_manager_transfer_deal_for_user(
  p_user_id uuid,
  p_world_id text,
  p_deal_id uuid,
  p_revision_no integer,
  p_action text,
  p_fee numeric default null,
  p_contract_years integer default null,
  p_request_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  action_value text := lower(trim(coalesce(p_action, '')));
  deal_row public.transfer_deals;
  current_revision public.transfer_deal_revisions;
  new_revision public.transfer_deal_revisions;
  participant public.transfer_deal_participants;
  buyer public.transfer_deal_participants;
  seller public.transfer_deal_participants;
  player_leg public.transfer_deal_legs;
  cash_leg public.transfer_deal_legs;
  existing_event public.transfer_deal_events;
  fee_value numeric;
  contract_years_value integer;
  request_lock_key bigint;
  approvals_count integer;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_deal_id is null then raise exception 'Deal is required'; end if;
  if p_revision_no is null or p_revision_no < 1 then raise exception 'Exact deal revision is required'; end if;
  if action_value not in ('accept', 'decline', 'counter') then raise exception 'Response action must be accept, decline or counter'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, p_deal_id::text), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_deal_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into deal_row from public.transfer_deals where id = existing_event.deal_id;
    return jsonb_build_object(
      'deal_id', deal_row.id,
      'status', deal_row.status,
      'revision_no', deal_row.current_revision_no,
      'idempotent', true
    );
  end if;

  select * into deal_row
  from public.transfer_deals deal
  where deal.id = p_deal_id and deal.world_id = p_world_id
  for update;
  if deal_row.id is null then raise exception 'Transfer deal was not found'; end if;
  if deal_row.status <> 'negotiating' then raise exception 'Only a negotiating deal can receive a response'; end if;
  if deal_row.current_revision_no <> p_revision_no then
    raise exception 'This offer revision is stale; refresh Transfers before responding';
  end if;

  select * into participant
  from public.transfer_deal_participants p
  where p.deal_id = deal_row.id and p.club_id = club_id_value and p.manager_id = manager_id_value;
  if participant.deal_id is null then raise exception 'Your club is not a participant in this transfer deal'; end if;

  select * into buyer from public.transfer_deal_participants p where p.deal_id = deal_row.id and p.role = 'buyer' limit 1;
  select * into seller from public.transfer_deal_participants p where p.deal_id = deal_row.id and p.role = 'seller' limit 1;
  select * into current_revision
  from public.transfer_deal_revisions revision
  where revision.deal_id = deal_row.id and revision.revision_no = p_revision_no;
  if current_revision.id is null then raise exception 'Current transfer revision was not found'; end if;

  if exists (
    select 1 from public.transfer_deal_approvals approval
    where approval.revision_id = current_revision.id and approval.club_id = club_id_value
  ) then
    raise exception 'Your club has already approved this exact revision';
  end if;

  select * into player_leg
  from public.transfer_deal_legs leg
  where leg.revision_id = current_revision.id and leg.leg_type = 'permanent_transfer'
  order by leg.sequence_no asc limit 1;
  select * into cash_leg
  from public.transfer_deal_legs leg
  where leg.revision_id = current_revision.id and leg.leg_type = 'cash'
  order by leg.sequence_no asc limit 1;
  if player_leg.id is null then raise exception 'Transfer revision does not contain a player leg'; end if;

  if action_value = 'decline' then
    insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
    values(current_revision.id, club_id_value, manager_id_value, 'declined');

    update public.transfer_deals
    set status = 'declined', terminal_reason = 'declined_by_participant', terminal_at = now(), updated_at = now()
    where id = deal_row.id returning * into deal_row;

    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(deal_row.id, p_world_id, manager_id_value, 'declined', p_request_key,
      jsonb_build_object('revision_no', p_revision_no, 'club_id', club_id_value));

    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', p_revision_no);
  end if;

  if action_value = 'accept' then
    insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
    values(current_revision.id, club_id_value, manager_id_value, 'approved');

    select count(*) into approvals_count
    from public.transfer_deal_approvals approval
    where approval.revision_id = current_revision.id
      and approval.decision = 'approved'
      and approval.club_id in (buyer.club_id, seller.club_id);

    if approvals_count = 2 then
      update public.transfer_deals
      set status = 'agreed', updated_at = now()
      where id = deal_row.id returning * into deal_row;
    end if;

    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(deal_row.id, p_world_id, manager_id_value, 'accepted', p_request_key,
      jsonb_build_object('revision_no', p_revision_no, 'club_id', club_id_value, 'deal_status', deal_row.status));

    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', p_revision_no);
  end if;

  fee_value := greatest(coalesce(p_fee, cash_leg.amount, 0), 0);
  contract_years_value := greatest(1, least(coalesce(
    p_contract_years,
    case when coalesce(player_leg.terms->>'contract_years', '') ~ '^[0-9]+$'
      then (player_leg.terms->>'contract_years')::integer else 3 end,
    3
  ), 5));

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(
    deal_row.id,
    p_revision_no + 1,
    manager_id_value,
    jsonb_build_object(
      'type', 'straight_transfer_counter',
      'player_id', player_leg.player_id,
      'fee', fee_value,
      'contract_years', contract_years_value,
      'supersedes_revision_no', p_revision_no
    )
  ) returning * into new_revision;

  insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms)
  values(new_revision.id, 1, 'permanent_transfer', seller.club_id, buyer.club_id, player_leg.player_id,
    jsonb_build_object('contract_years', contract_years_value));
  if fee_value > 0 then
    insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount)
    values(new_revision.id, 2, 'cash', buyer.club_id, seller.club_id, fee_value);
  end if;

  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
  values(new_revision.id, club_id_value, manager_id_value, 'approved');

  update public.transfer_deals
  set current_revision_no = new_revision.revision_no, updated_at = now()
  where id = deal_row.id returning * into deal_row;

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(deal_row.id, p_world_id, manager_id_value, 'countered', p_request_key,
    jsonb_build_object(
      'from_revision_no', p_revision_no,
      'revision_no', new_revision.revision_no,
      'club_id', club_id_value,
      'fee', fee_value,
      'contract_years', contract_years_value
    ));

  return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', new_revision.revision_no);
end;
$$;

create or replace function public.get_manager_transfer_market_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  listings_value jsonb;
  outgoing_value jsonb;
  incoming_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select save_checksum into canonical_checksum from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'listing_id', listing.id,
    'player_id', listing.player_id,
    'player_name', coalesce(
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'display_name'],
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'player_name'],
      listing.player_id
    ),
    'club_id', listing.club_id,
    'asking_fee', listing.asking_fee,
    'status', listing.status,
    'created_at', listing.created_at,
    'updated_at', listing.updated_at,
    'is_own_listing', listing.club_id = club_id_value
  ) order by listing.updated_at desc), '[]'::jsonb)
  into listings_value
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.status = 'active'
    and coalesce(cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'club_id'], '') = listing.club_id;

  with visible_deals as (
    select deal.id, deal.status, deal.created_at, deal.updated_at, deal.current_revision_no,
           revision.id as revision_id, revision.created_by_manager_id,
           buyer.club_id as buyer_club_id, buyer.manager_id as buyer_manager_id,
           seller.club_id as seller_club_id, seller.manager_id as seller_manager_id,
           player_leg.player_id,
           coalesce(cash_leg.amount, 0) as fee,
           case when coalesce(player_leg.terms->>'contract_years', '') ~ '^[0-9]+$'
             then greatest(1, least((player_leg.terms->>'contract_years')::integer, 5)) else 3 end as contract_years,
           exists(
             select 1 from public.transfer_deal_approvals approval
             where approval.revision_id = revision.id
               and approval.club_id = club_id_value
               and approval.decision = 'approved'
           ) as your_approved,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'revision_no', history.revision_no,
               'created_by_manager_id', history.created_by_manager_id,
               'summary', history.summary,
               'created_at', history.created_at
             ) order by history.revision_no asc)
             from public.transfer_deal_revisions history
             where history.deal_id = deal.id
           ), '[]'::jsonb) as revision_history
    from public.transfer_deals deal
    join public.transfer_deal_participants buyer on buyer.deal_id = deal.id and buyer.role = 'buyer'
    join public.transfer_deal_participants seller on seller.deal_id = deal.id and seller.role = 'seller'
    join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs player_leg on player_leg.revision_id = revision.id and player_leg.leg_type = 'permanent_transfer'
    left join public.transfer_deal_legs cash_leg on cash_leg.revision_id = revision.id and cash_leg.leg_type = 'cash'
    where deal.world_id = p_world_id and deal.status in ('negotiating', 'agreed')
  ), projected as (
    select *,
      (status = 'negotiating' and not your_approved) as requires_action,
      case
        when status = 'agreed' then 'agreed'
        when your_approved then 'awaiting_other_club'
        else 'your_response_required'
      end as response_state
    from visible_deals
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id, 'status', status, 'revision_no', current_revision_no,
      'revision_created_by_manager_id', created_by_manager_id,
      'player_id', player_id,
      'player_name', coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',player_id,'player_name'], player_id),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name']),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name']),
      'fee', fee, 'contract_years', contract_years,
      'requires_action', requires_action, 'response_state', response_state,
      'revision_history', revision_history,
      'created_at', created_at, 'updated_at', updated_at
    ) order by updated_at desc) filter (where buyer_club_id = club_id_value), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id, 'status', status, 'revision_no', current_revision_no,
      'revision_created_by_manager_id', created_by_manager_id,
      'player_id', player_id,
      'player_name', coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',player_id,'player_name'], player_id),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name']),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name']),
      'fee', fee, 'contract_years', contract_years,
      'requires_action', requires_action, 'response_state', response_state,
      'revision_history', revision_history,
      'created_at', created_at, 'updated_at', updated_at
    ) order by updated_at desc) filter (where seller_club_id = club_id_value), '[]'::jsonb)
  into outgoing_value, incoming_value
  from projected;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'listings', listings_value,
    'outgoing_offers', outgoing_value,
    'incoming_offers', incoming_value
  );
end;
$$;

revoke all on function public.respond_manager_transfer_deal_for_user(uuid,text,uuid,integer,text,numeric,integer,text)
  from public, anon, authenticated;
grant execute on function public.respond_manager_transfer_deal_for_user(uuid,text,uuid,integer,text,numeric,integer,text)
  to service_role;

revoke update, delete on table public.transfer_deal_events from service_role;

commit;
