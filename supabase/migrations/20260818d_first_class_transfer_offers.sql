-- #240 Slice B1: immediate first-class offers and buyer withdrawal.

begin;

create table if not exists public.transfer_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.transfer_deals(id) on delete cascade,
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  event_type text not null check (event_type in ('offered', 'withdrawn')),
  request_key text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(world_id, manager_id, request_key)
);

create index if not exists transfer_deal_events_deal_idx
  on public.transfer_deal_events(deal_id, created_at asc);

alter table public.transfer_deal_events enable row level security;
revoke all on table public.transfer_deal_events from anon, authenticated;
grant select, insert on table public.transfer_deal_events to service_role;

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

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  select * into cache_row
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1;

  if cache_row.read_model is null
     or canonical_checksum is null
     or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
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
    ) order by listing.updated_at desc
  ), '[]'::jsonb)
  into listings_value
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.status = 'active'
    and coalesce(cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'club_id'], '') = listing.club_id;

  with visible_deals as (
    select deal.id, deal.status, deal.created_at, deal.updated_at,
           buyer.club_id as buyer_club_id,
           seller.club_id as seller_club_id,
           player_leg.player_id,
           coalesce(cash_leg.amount, 0) as fee,
           coalesce((player_leg.terms->>'contract_years')::integer, 3) as contract_years
    from public.transfer_deals deal
    join public.transfer_deal_participants buyer on buyer.deal_id = deal.id and buyer.role = 'buyer'
    join public.transfer_deal_participants seller on seller.deal_id = deal.id and seller.role = 'seller'
    join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs player_leg on player_leg.revision_id = revision.id and player_leg.leg_type = 'permanent_transfer'
    left join public.transfer_deal_legs cash_leg on cash_leg.revision_id = revision.id and cash_leg.leg_type = 'cash'
    where deal.world_id = p_world_id and deal.status = 'negotiating'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id,
      'status', status,
      'player_id', player_id,
      'player_name', coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',player_id,'player_name'],
        player_id
      ),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(cache_row.read_model #>> array['directory','clubs',buyer_club_id,'club_name'], buyer_club_id),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(cache_row.read_model #>> array['directory','clubs',seller_club_id,'club_name'], seller_club_id),
      'fee', fee,
      'contract_years', contract_years,
      'created_at', created_at,
      'updated_at', updated_at
    ) order by updated_at desc) filter (where buyer_club_id = club_id_value), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id,
      'status', status,
      'player_id', player_id,
      'player_name', coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',player_id,'player_name'],
        player_id
      ),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(cache_row.read_model #>> array['directory','clubs',buyer_club_id,'club_name'], buyer_club_id),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(cache_row.read_model #>> array['directory','clubs',seller_club_id,'club_name'], seller_club_id),
      'fee', fee,
      'contract_years', contract_years,
      'created_at', created_at,
      'updated_at', updated_at
    ) order by updated_at desc) filter (where seller_club_id = club_id_value), '[]'::jsonb)
  into outgoing_value, incoming_value
  from visible_deals;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'listings', listings_value,
    'outgoing_offers', outgoing_value,
    'incoming_offers', incoming_value
  );
end;
$$;

create or replace function public.set_manager_transfer_offer_for_user(
  p_user_id uuid,
  p_world_id text,
  p_action text,
  p_player_id text default null,
  p_seller_club_id text default null,
  p_fee numeric default 0,
  p_contract_years integer default 3,
  p_deal_id uuid default null,
  p_request_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  buyer_club_id_value text;
  seller_manager_id_value uuid;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  player_value jsonb;
  action_value text := lower(trim(coalesce(p_action, '')));
  fee_value numeric := greatest(coalesce(p_fee, 0), 0);
  contract_years_value integer := greatest(1, least(coalesce(p_contract_years, 3), 5));
  deal_row public.transfer_deals;
  revision_row public.transfer_deal_revisions;
  existing_event public.transfer_deal_events;
  request_lock_key bigint;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if action_value not in ('offer', 'withdraw_offer') then raise exception 'Offer action must be offer or withdraw_offer'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, buyer_club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, manager_id_value::text, p_request_key), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_deal_events event
  where event.world_id = p_world_id and event.manager_id = manager_id_value and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into deal_row from public.transfer_deals where id = existing_event.deal_id;
    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'idempotent', true);
  end if;

  if action_value = 'withdraw_offer' then
    if p_deal_id is null then raise exception 'Deal is required'; end if;
    select * into deal_row from public.transfer_deals where id = p_deal_id and world_id = p_world_id for update;
    if deal_row.id is null then raise exception 'Transfer offer was not found'; end if;
    if deal_row.created_by_manager_id <> manager_id_value then raise exception 'Only the manager who made this offer can withdraw it'; end if;
    if deal_row.status <> 'negotiating' then raise exception 'Only a negotiating offer can be withdrawn'; end if;

    update public.transfer_deals
    set status = 'withdrawn', terminal_reason = 'withdrawn_by_buyer', terminal_at = now(), updated_at = now()
    where id = deal_row.id returning * into deal_row;

    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(deal_row.id, p_world_id, manager_id_value, 'withdrawn', p_request_key,
      jsonb_build_object('reason', 'withdrawn_by_buyer'));

    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status);
  end if;

  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if trim(coalesce(p_seller_club_id, '')) = '' or p_seller_club_id = buyer_club_id_value then raise exception 'A different selling club is required'; end if;

  select save_checksum into canonical_checksum from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  player_value := cache_row.read_model #> array['squad_cycle','players',p_player_id];
  if player_value is null then raise exception 'Player is not present in the canonical world'; end if;
  if coalesce(player_value->>'club_id', '') <> p_seller_club_id then raise exception 'The selling club does not own this player'; end if;

  select appointment.manager_id into seller_manager_id_value
  from public.manager_appointments appointment
  where appointment.world_id = p_world_id and appointment.club_id = p_seller_club_id and appointment.status = 'active'
  limit 1;
  if seller_manager_id_value is null then raise exception 'Transfer offers currently require a human-managed selling club'; end if;

  insert into public.transfer_deals(world_id, created_by_manager_id, status, current_revision_no)
  values(p_world_id, manager_id_value, 'negotiating', 1)
  returning * into deal_row;

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(deal_row.id, 1, manager_id_value,
    jsonb_build_object('type', 'straight_transfer_offer', 'player_id', p_player_id, 'fee', fee_value, 'contract_years', contract_years_value))
  returning * into revision_row;

  insert into public.transfer_deal_participants(deal_id, club_id, manager_id, role) values
    (deal_row.id, buyer_club_id_value, manager_id_value, 'buyer'),
    (deal_row.id, p_seller_club_id, seller_manager_id_value, 'seller');

  insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms)
  values(revision_row.id, 1, 'permanent_transfer', p_seller_club_id, buyer_club_id_value, p_player_id,
    jsonb_build_object('contract_years', contract_years_value));

  if fee_value > 0 then
    insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount)
    values(revision_row.id, 2, 'cash', buyer_club_id_value, p_seller_club_id, fee_value);
  end if;

  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
  values(revision_row.id, buyer_club_id_value, manager_id_value, 'approved');

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(deal_row.id, p_world_id, manager_id_value, 'offered', p_request_key,
    jsonb_build_object('player_id', p_player_id, 'seller_club_id', p_seller_club_id, 'fee', fee_value, 'contract_years', contract_years_value));

  return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', 1);
end;
$$;

revoke all on function public.set_manager_transfer_offer_for_user(uuid,text,text,text,text,numeric,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.set_manager_transfer_offer_for_user(uuid,text,text,text,text,numeric,integer,uuid,text)
  to service_role;

revoke update, delete on table public.transfer_deal_events from service_role;

commit;
