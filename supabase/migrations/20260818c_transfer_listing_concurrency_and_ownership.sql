-- #240: make live listing mutations safe under ownership changes and concurrent retries.

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
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  listings_value jsonb;
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
    -- An ownership-changing canonical checkpoint can race ahead of the listing
    -- ledger. Never advertise a listing whose seller no longer owns the player.
    and coalesce(
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'club_id'],
      ''
    ) = listing.club_id;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'listings', listings_value
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
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  player_value jsonb;
  existing_event public.transfer_market_listing_events;
  listing_row public.transfer_market_listings;
  stale_listing public.transfer_market_listings;
  action_value text := lower(trim(coalesce(p_action, '')));
  fee_value numeric := greatest(coalesce(p_asking_fee, 0), 0);
  request_lock_key bigint;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if action_value not in ('list', 'withdraw') then raise exception 'Listing action must be list or withdraw'; end if;
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

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  -- Serialize identical requests before checking the immutable event ledger.
  -- A retry arriving while the first request is still committing waits here,
  -- then returns that request's committed listing instead of racing a unique key.
  request_lock_key := pg_catalog.hashtextextended(
    concat_ws('|', p_world_id, manager_id_value::text, p_request_key),
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_market_listing_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;

  if existing_event.id is not null then
    select * into listing_row
    from public.transfer_market_listings
    where id = existing_event.listing_id;
    return listing_row;
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

  player_value := cache_row.read_model #> array['squad_cycle','players',p_player_id];
  if player_value is null then raise exception 'Player is not present in the canonical world'; end if;
  if coalesce(player_value->>'club_id', '') <> club_id_value then
    raise exception 'Only a player owned by the appointed club can be listed or withdrawn';
  end if;

  -- Lock any active row for this player. If a canonical transfer changed the
  -- owner since it was listed, retire the former seller's listing before the
  -- current owner is allowed to create a fresh one.
  select * into listing_row
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.player_id = p_player_id
    and listing.status = 'active'
  for update;

  if listing_row.id is not null and listing_row.club_id <> club_id_value then
    stale_listing := listing_row;

    update public.transfer_market_listings
    set status = 'withdrawn',
        withdrawn_at = now(),
        updated_at = now()
    where id = stale_listing.id;

    insert into public.transfer_market_listing_events (
      listing_id, world_id, player_id, club_id, manager_id,
      event_type, asking_fee, request_key, details
    ) values (
      stale_listing.id,
      stale_listing.world_id,
      stale_listing.player_id,
      stale_listing.club_id,
      stale_listing.manager_id,
      'withdrawn',
      stale_listing.asking_fee,
      'ownership-change:' || stale_listing.id::text || ':' || canonical_checksum,
      jsonb_build_object(
        'reason', 'canonical_player_ownership_changed',
        'new_club_id', club_id_value,
        'canonical_checksum', canonical_checksum
      )
    ) on conflict (world_id, manager_id, request_key) do nothing;

    listing_row := null;
  end if;

  if action_value = 'list' then
    if listing_row.id is null then
      insert into public.transfer_market_listings (
        world_id, player_id, club_id, manager_id, asking_fee, status
      ) values (
        p_world_id, p_player_id, club_id_value, manager_id_value, fee_value, 'active'
      ) returning * into listing_row;

      insert into public.transfer_market_listing_events (
        listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
      ) values (
        listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
        'listed', fee_value, p_request_key
      );
    else
      update public.transfer_market_listings
      set asking_fee = fee_value,
          manager_id = manager_id_value,
          club_id = club_id_value,
          updated_at = now()
      where id = listing_row.id
      returning * into listing_row;

      insert into public.transfer_market_listing_events (
        listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
      ) values (
        listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
        'updated', fee_value, p_request_key
      );
    end if;

    return listing_row;
  end if;

  if listing_row.id is null then
    raise exception 'Player does not have an active transfer listing';
  end if;

  update public.transfer_market_listings
  set status = 'withdrawn',
      withdrawn_at = now(),
      updated_at = now()
  where id = listing_row.id
  returning * into listing_row;

  insert into public.transfer_market_listing_events (
    listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
  ) values (
    listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
    'withdrawn', listing_row.asking_fee, p_request_key
  );

  return listing_row;
end;
$$;

revoke all on function public.get_manager_transfer_market_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_market_for_user(uuid, text)
  to service_role;

revoke all on function public.set_manager_transfer_listing_for_user(uuid, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.set_manager_transfer_listing_for_user(uuid, text, text, text, numeric, text)
  to service_role;

commit;
