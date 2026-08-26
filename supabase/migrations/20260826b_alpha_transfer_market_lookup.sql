-- Continue the controlled-alpha transfer read-path hardening.
-- The market/listing gateway must use the compact transfer lookup rather than world_read_model_cache.

begin;

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
  lookup jsonb;
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

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'listing_id', listing.id,
    'player_id', listing.player_id,
    'player_name', coalesce(lookup -> 'players_by_id' -> listing.player_id ->> 'player_name', listing.player_id),
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
    and coalesce(lookup -> 'players_by_id' -> listing.player_id ->> 'club_id', '') = listing.club_id;

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
      case when status = 'agreed' then 'agreed'
           when your_approved then 'awaiting_other_club'
           else 'your_response_required' end as response_state
    from visible_deals
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id, 'status', status, 'revision_no', current_revision_no,
      'revision_created_by_manager_id', created_by_manager_id,
      'player_id', player_id,
      'player_name', coalesce(lookup -> 'players_by_id' -> player_id ->> 'player_name', player_id),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(lookup -> 'clubs_by_id' -> buyer_club_id ->> 'club_name', buyer_club_id),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(lookup -> 'clubs_by_id' -> seller_club_id ->> 'club_name', seller_club_id),
      'fee', fee, 'contract_years', contract_years,
      'requires_action', requires_action, 'response_state', response_state,
      'revision_history', revision_history,
      'created_at', created_at, 'updated_at', updated_at
    ) order by updated_at desc) filter (where buyer_club_id = club_id_value), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'deal_id', id, 'status', status, 'revision_no', current_revision_no,
      'revision_created_by_manager_id', created_by_manager_id,
      'player_id', player_id,
      'player_name', coalesce(lookup -> 'players_by_id' -> player_id ->> 'player_name', player_id),
      'buyer_club_id', buyer_club_id,
      'buyer_club_name', coalesce(lookup -> 'clubs_by_id' -> buyer_club_id ->> 'club_name', buyer_club_id),
      'seller_club_id', seller_club_id,
      'seller_club_name', coalesce(lookup -> 'clubs_by_id' -> seller_club_id ->> 'club_name', seller_club_id),
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

create or replace function public.set_manager_transfer_listing_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text,
  p_action text,
  p_asking_fee numeric,
  p_request_key text
) returns public.transfer_market_listings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  lookup jsonb;
  player_value jsonb;
  existing_event public.transfer_market_listing_events;
  listing_row public.transfer_market_listings;
  action_value text := lower(trim(coalesce(p_action, '')));
  fee_value numeric := greatest(coalesce(p_asking_fee, 0), 0);
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if action_value not in ('list', 'withdraw') then raise exception 'Listing action must be list or withdraw'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;

  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select * into existing_event
  from public.transfer_market_listing_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into listing_row from public.transfer_market_listings where id = existing_event.listing_id;
    return listing_row;
  end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);
  player_value := lookup -> 'players_by_id' -> p_player_id;
  if player_value is null then raise exception 'Player is not present in the managed transfer directory'; end if;
  if coalesce(player_value->>'club_id', '') <> club_id_value then
    raise exception 'Only a player owned by the appointed club can be listed or withdrawn';
  end if;

  select * into listing_row
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.player_id = p_player_id
    and listing.status = 'active'
  for update;

  if action_value = 'list' then
    if listing_row.id is null then
      insert into public.transfer_market_listings(world_id, player_id, club_id, manager_id, asking_fee, status)
      values (p_world_id, p_player_id, club_id_value, manager_id_value, fee_value, 'active')
      returning * into listing_row;
      insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
      values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'listed', fee_value, p_request_key);
    else
      update public.transfer_market_listings
      set asking_fee = fee_value, updated_at = now()
      where id = listing_row.id
      returning * into listing_row;
      insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
      values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'updated', fee_value, p_request_key);
    end if;
    return listing_row;
  end if;

  if listing_row.id is null then raise exception 'Player does not have an active transfer listing'; end if;
  update public.transfer_market_listings
  set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  where id = listing_row.id
  returning * into listing_row;
  insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
  values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'withdrawn', listing_row.asking_fee, p_request_key);
  return listing_row;
end;
$$;

revoke all on function public.get_manager_transfer_market_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.set_manager_transfer_listing_for_user(uuid,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_market_for_user(uuid,text) to service_role;
grant execute on function public.set_manager_transfer_listing_for_user(uuid,text,text,text,numeric,text) to service_role;

commit;
