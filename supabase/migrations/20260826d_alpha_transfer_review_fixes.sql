begin;

-- Keep the compact transfer directory keyed by both canonical state and the
-- active-manager appointment set, and retain age in the compact player projection.
create or replace function public.get_manager_transfer_directory_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  stored_checksum text;
  stored_turn_status text;
  stored_updated_at timestamptz;
  current_appointment_fingerprint text;
  envelope jsonb;
  world jsonb;
  squad_cycle jsonb;
  appointed_club_id text;
  cached_directory jsonb;
  clubs jsonb := '[]'::jsonb;
  players jsonb := '[]'::jsonb;
  decorated_clubs jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select appointment.club_id into appointed_club_id
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
   where profile.user_id = p_user_id
   limit 1;
  if appointed_club_id is null then raise exception 'No active manager appointment for this user and world'; end if;

  select md5(coalesce(string_agg(appointment.manager_id::text || ':' || appointment.club_id, ',' order by appointment.manager_id::text, appointment.club_id), ''))
    into current_appointment_fingerprint
    from public.manager_appointments appointment
   where appointment.world_id = p_world_id
     and appointment.status = 'active';

  select save_checksum, turn_status, updated_at
    into stored_checksum, stored_turn_status, stored_updated_at
    from public.canonical_world_saves
   where world_id = p_world_id
   limit 1;
  if not found then return null; end if;

  select cache.directory into cached_directory
    from public.manager_transfer_directory_cache cache
   where cache.world_id = p_world_id
     and cache.source_checksum = stored_checksum
     and cache.appointment_fingerprint = current_appointment_fingerprint;

  if cached_directory is null then
    select save_envelope into envelope
      from public.canonical_world_saves
     where world_id = p_world_id
       and save_checksum = stored_checksum
     limit 1;
    if envelope is null then raise exception 'Canonical world % changed while building transfer directory', p_world_id; end if;
    if coalesce(envelope ->> 'save_version', '') <> 'tbg-playable-world-save-v1.0'
       or coalesce(envelope ->> 'checksum', '') <> stored_checksum then
      raise exception 'Canonical save metadata mismatch for world %', p_world_id;
    end if;

    world := envelope -> 'world';
    if world is null or jsonb_typeof(world) <> 'object'
       or coalesce(world ->> 'world_id', '') <> p_world_id
       or jsonb_typeof(world -> 'squad_cycle') <> 'object' then
      raise exception 'Canonical world % failed transfer-directory integrity validation', p_world_id;
    end if;
    squad_cycle := world -> 'squad_cycle';

    with managed as (
      select distinct appointment.club_id
        from public.manager_appointments appointment
       where appointment.world_id = p_world_id and appointment.status = 'active'
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'club_id', managed.club_id,
      'club_name', coalesce(world -> 'club_profiles' -> managed.club_id ->> 'club_name', world -> 'club_profiles' -> managed.club_id ->> 'canonical_name', managed.club_id),
      'managed', true
    ) order by coalesce(world -> 'club_profiles' -> managed.club_id ->> 'club_name', world -> 'club_profiles' -> managed.club_id ->> 'canonical_name', managed.club_id)), '[]'::jsonb)
      into clubs
      from managed
     where squad_cycle -> 'clubs' ? managed.club_id;

    with managed as (
      select distinct appointment.club_id
        from public.manager_appointments appointment
       where appointment.world_id = p_world_id and appointment.status = 'active'
    ), owned as (
      select managed.club_id, player_id
        from managed
        cross join lateral jsonb_array_elements_text(coalesce(squad_cycle -> 'clubs' -> managed.club_id -> 'player_ids', '[]'::jsonb)) player_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'player_id', owned.player_id,
      'player_name', coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'display_name', squad_cycle -> 'players' -> owned.player_id ->> 'player_name', squad_cycle -> 'players' -> owned.player_id ->> 'name', owned.player_id),
      'club_id', owned.club_id,
      'club_name', coalesce(world -> 'club_profiles' -> owned.club_id ->> 'club_name', world -> 'club_profiles' -> owned.club_id ->> 'canonical_name', owned.club_id),
      'position', coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'specific_position', squad_cycle -> 'players' -> owned.player_id ->> 'primary_position', squad_cycle -> 'players' -> owned.player_id ->> 'position', '—'),
      'rating', case when coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'underlying_ability_rating', squad_cycle -> 'players' -> owned.player_id ->> 'tbg_rating', squad_cycle -> 'players' -> owned.player_id ->> 'rating', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'underlying_ability_rating', squad_cycle -> 'players' -> owned.player_id ->> 'tbg_rating', squad_cycle -> 'players' -> owned.player_id ->> 'rating')::numeric
        else null end,
      'age', case when coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'age', '') ~ '^[0-9]+$'
        then (squad_cycle -> 'players' -> owned.player_id ->> 'age')::integer else null end
    ) order by coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'display_name', squad_cycle -> 'players' -> owned.player_id ->> 'player_name', squad_cycle -> 'players' -> owned.player_id ->> 'name', owned.player_id)), '[]'::jsonb)
      into players
      from owned
     where squad_cycle -> 'players' ? owned.player_id;

    cached_directory := jsonb_build_object('clubs', clubs, 'players', players);
    insert into public.manager_transfer_directory_cache(world_id, source_checksum, appointment_fingerprint, directory, refreshed_at)
    values (p_world_id, stored_checksum, current_appointment_fingerprint, cached_directory, now())
    on conflict (world_id) do update
      set source_checksum = excluded.source_checksum,
          appointment_fingerprint = excluded.appointment_fingerprint,
          directory = excluded.directory,
          refreshed_at = excluded.refreshed_at;
  end if;

  select coalesce(jsonb_agg(club.value || jsonb_build_object('appointed', club.value ->> 'club_id' = appointed_club_id)), '[]'::jsonb)
    into decorated_clubs
    from jsonb_array_elements(coalesce(cached_directory -> 'clubs', '[]'::jsonb)) club(value);

  return jsonb_build_object(
    'world_id', p_world_id,
    'save_checksum', stored_checksum,
    'turn_status', stored_turn_status,
    'updated_at', stored_updated_at,
    'directory', jsonb_build_object(
      'clubs', decorated_clubs,
      'players', coalesce(cached_directory -> 'players', '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_manager_transfer_lookup_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical_checksum text;
  current_appointment_fingerprint text;
  cached_directory jsonb;
  directory_payload jsonb;
  players_by_id jsonb := '{}'::jsonb;
  clubs_by_id jsonb := '{}'::jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves where world_id = p_world_id limit 1;
  if canonical_checksum is null then return null; end if;

  select md5(coalesce(string_agg(appointment.manager_id::text || ':' || appointment.club_id, ',' order by appointment.manager_id::text, appointment.club_id), ''))
    into current_appointment_fingerprint
    from public.manager_appointments appointment
   where appointment.world_id = p_world_id and appointment.status = 'active';

  select cache.directory into cached_directory
  from public.manager_transfer_directory_cache cache
  where cache.world_id = p_world_id
    and cache.source_checksum = canonical_checksum
    and cache.appointment_fingerprint = current_appointment_fingerprint;

  if cached_directory is null then
    perform pg_advisory_xact_lock(hashtextextended('tbg-transfer-directory:' || p_world_id, 0));

    select cache.directory into cached_directory
    from public.manager_transfer_directory_cache cache
    where cache.world_id = p_world_id
      and cache.source_checksum = canonical_checksum
      and cache.appointment_fingerprint = current_appointment_fingerprint;

    if cached_directory is null then
      directory_payload := public.get_manager_transfer_directory_for_user(p_user_id, p_world_id);
      cached_directory := directory_payload -> 'directory';
    end if;
  end if;

  if cached_directory is null then raise exception 'Transfer directory is refreshing; please retry shortly'; end if;

  select coalesce(jsonb_object_agg(player.value ->> 'player_id', player.value), '{}'::jsonb)
    into players_by_id
    from jsonb_array_elements(coalesce(cached_directory -> 'players', '[]'::jsonb)) player(value)
   where coalesce(player.value ->> 'player_id', '') <> '';

  select coalesce(jsonb_object_agg(club.value ->> 'club_id', club.value), '{}'::jsonb)
    into clubs_by_id
    from jsonb_array_elements(coalesce(cached_directory -> 'clubs', '[]'::jsonb)) club(value)
   where coalesce(club.value ->> 'club_id', '') <> '';

  return jsonb_build_object('save_checksum', canonical_checksum, 'appointment_fingerprint', current_appointment_fingerprint, 'players_by_id', players_by_id, 'clubs_by_id', clubs_by_id);
end;
$$;

create or replace function public.get_manager_transfer_exchange_legs_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  lookup jsonb;
  result_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment on appointment.manager_id = profile.id and appointment.world_id = p_world_id and appointment.status = 'active'
  where profile.user_id = p_user_id limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'revision_no', revision.revision_no,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.from_club_id ->> 'club_name', leg.from_club_id),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.to_club_id ->> 'club_name', leg.to_club_id),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(lookup -> 'players_by_id' -> leg.player_id ->> 'player_name', leg.player_id) end,
        'position', case when leg.player_id is null then null else lookup -> 'players_by_id' -> leg.player_id ->> 'position' end,
        'rating', case when leg.player_id is null then null else lookup -> 'players_by_id' -> leg.player_id ->> 'rating' end,
        'age', case when leg.player_id is null then null else lookup -> 'players_by_id' -> leg.player_id -> 'age' end,
        'amount', leg.amount,
        'contract_years', case when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$' then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else null end
      ) order by leg.sequence_no asc)
      from public.transfer_deal_legs leg where leg.revision_id = revision.id
    ), '[]'::jsonb)
  ) order by deal.updated_at desc), '[]'::jsonb)
  into result_value
  from public.transfer_deals deal
  join public.transfer_deal_participants participant on participant.deal_id = deal.id and participant.club_id = club_id_value
  join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  where deal.world_id = p_world_id and deal.status in ('negotiating', 'agreed', 'grace_period', 'binding', 'settling');

  return result_value;
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
  canonical_checksum text;
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

  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment on appointment.manager_id = profile.id and appointment.world_id = p_world_id and appointment.status = 'active'
  where profile.user_id = p_user_id limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, manager_id_value::text, p_request_key), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_market_listing_events event
  where event.world_id = p_world_id and event.manager_id = manager_id_value and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into listing_row from public.transfer_market_listings where id = existing_event.listing_id;
    return listing_row;
  end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);
  canonical_checksum := lookup ->> 'save_checksum';
  player_value := lookup -> 'players_by_id' -> p_player_id;
  if player_value is null then raise exception 'Player is not present in the managed transfer directory'; end if;
  if coalesce(player_value->>'club_id', '') <> club_id_value then raise exception 'Only a player owned by the appointed club can be listed or withdrawn'; end if;

  select * into listing_row
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id and listing.player_id = p_player_id and listing.status = 'active'
  for update;

  if listing_row.id is not null and listing_row.club_id <> club_id_value then
    stale_listing := listing_row;
    update public.transfer_market_listings set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = stale_listing.id;
    insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key, details)
    values (stale_listing.id, stale_listing.world_id, stale_listing.player_id, stale_listing.club_id, stale_listing.manager_id,
      'withdrawn', stale_listing.asking_fee, 'ownership-change:' || stale_listing.id::text || ':' || canonical_checksum,
      jsonb_build_object('reason', 'canonical_player_ownership_changed', 'new_club_id', club_id_value, 'canonical_checksum', canonical_checksum))
    on conflict (world_id, manager_id, request_key) do nothing;
    listing_row := null;
  end if;

  if action_value = 'list' then
    if listing_row.id is null then
      insert into public.transfer_market_listings(world_id, player_id, club_id, manager_id, asking_fee, status)
      values (p_world_id, p_player_id, club_id_value, manager_id_value, fee_value, 'active') returning * into listing_row;
      insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
      values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'listed', fee_value, p_request_key);
    else
      update public.transfer_market_listings set asking_fee = fee_value, manager_id = manager_id_value, club_id = club_id_value, updated_at = now()
      where id = listing_row.id returning * into listing_row;
      insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
      values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'updated', fee_value, p_request_key);
    end if;
    return listing_row;
  end if;

  if listing_row.id is null then raise exception 'Player does not have an active transfer listing'; end if;
  update public.transfer_market_listings set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  where id = listing_row.id returning * into listing_row;
  insert into public.transfer_market_listing_events(listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key)
  values (listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value, 'withdrawn', listing_row.asking_fee, p_request_key);
  return listing_row;
end;
$$;

revoke all on function public.get_manager_transfer_directory_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_lookup_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_exchange_legs_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.set_manager_transfer_listing_for_user(uuid,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_directory_for_user(uuid,text) to service_role;
grant execute on function public.get_manager_transfer_lookup_for_user(uuid,text) to service_role;
grant execute on function public.get_manager_transfer_exchange_legs_for_user(uuid,text) to service_role;
grant execute on function public.set_manager_transfer_listing_for_user(uuid,text,text,text,numeric,text) to service_role;

commit;
