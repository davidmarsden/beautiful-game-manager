-- Production read-path hardening after Matchday 7 resource pressure.
-- Ordinary portal reads must not repeatedly detoast and traverse the canonical world JSONB.

create table if not exists public.manager_portal_fragment_cache (
  world_id text not null,
  club_id text not null,
  source_checksum text not null,
  fragment jsonb not null,
  refreshed_at timestamptz not null default now(),
  primary key (world_id, club_id)
);

create table if not exists public.manager_transfer_directory_cache (
  world_id text primary key,
  source_checksum text not null,
  directory jsonb not null,
  refreshed_at timestamptz not null default now()
);

revoke all on public.manager_portal_fragment_cache from public, anon, authenticated;
revoke all on public.manager_transfer_directory_cache from public, anon, authenticated;
grant all on public.manager_portal_fragment_cache to service_role;
grant all on public.manager_transfer_directory_cache to service_role;

create or replace function public.get_manager_portal_world_fragment(p_world_id text, p_club_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  stored_checksum text;
  stored_season_id text;
  stored_season_number integer;
  stored_phase text;
  stored_matchday integer;
  stored_next_turn_at timestamptz;
  stored_turn_status text;
  stored_created_at timestamptz;
  stored_updated_at timestamptz;
  envelope jsonb;
  world jsonb;
  squad_cycle jsonb;
  club jsonb;
  player_ids jsonb;
  players jsonb := '{}'::jsonb;
  contracts jsonb := '{}'::jsonb;
  player_ownership jsonb := '[]'::jsonb;
  division jsonb;
  division_id text;
  runtime jsonb;
  compact_results jsonb := '[]'::jsonb;
  compact_archive_results jsonb := '[]'::jsonb;
  runtime_players jsonb := '{}'::jsonb;
  runtime_availability_players jsonb := '{}'::jsonb;
  slim_runtime jsonb;
  fragment jsonb;
begin
  -- Metadata is small and stays on the hot path. Do not touch save_envelope on a cache hit.
  select save_checksum, season_id, season_number, phase, matchday, next_turn_at,
         turn_status, created_at, updated_at
    into stored_checksum, stored_season_id, stored_season_number, stored_phase,
         stored_matchday, stored_next_turn_at, stored_turn_status, stored_created_at,
         stored_updated_at
    from public.canonical_world_saves
   where world_id = p_world_id
   limit 1;

  if not found then
    return null;
  end if;

  select cache.fragment
    into fragment
    from public.manager_portal_fragment_cache cache
   where cache.world_id = p_world_id
     and cache.club_id = p_club_id
     and cache.source_checksum = stored_checksum;

  if found then
    return jsonb_build_object(
      'world_id', p_world_id,
      'save_checksum', stored_checksum,
      'season_id', stored_season_id,
      'season_number', stored_season_number,
      'phase', stored_phase,
      'matchday', stored_matchday,
      'next_turn_at', stored_next_turn_at,
      'turn_status', stored_turn_status,
      'created_at', stored_created_at,
      'updated_at', stored_updated_at,
      'world', fragment
    );
  end if;

  select save_envelope
    into envelope
    from public.canonical_world_saves
   where world_id = p_world_id
     and save_checksum = stored_checksum
   limit 1;

  if envelope is null then
    raise exception 'Canonical world % changed while building manager portal projection', p_world_id;
  end if;
  if coalesce(envelope ->> 'save_version', '') <> 'tbg-playable-world-save-v1.0'
     or coalesce(envelope ->> 'checksum', '') <> stored_checksum then
    raise exception 'Canonical save checksum metadata mismatch for world %', p_world_id;
  end if;

  world := envelope -> 'world';
  if world is null or jsonb_typeof(world) <> 'object'
     or coalesce(world ->> 'world_id', '') <> p_world_id
     or coalesce(world ->> 'version', '') <> 'tbg-playable-persistent-world-v1.0'
     or jsonb_typeof(world -> 'squad_cycle') <> 'object'
     or coalesce(world -> 'squad_cycle' ->> 'season_id', '') <> stored_season_id then
    raise exception 'Canonical world % failed fragment integrity validation', p_world_id;
  end if;

  squad_cycle := world -> 'squad_cycle';
  club := squad_cycle -> 'clubs' -> p_club_id;
  if club is null then
    raise exception 'Appointment club % is not present in canonical world %', p_club_id, p_world_id;
  end if;
  player_ids := coalesce(club -> 'player_ids', '[]'::jsonb);

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into players
    from jsonb_each(coalesce(squad_cycle -> 'players', '{}'::jsonb)) entry
   where entry.key in (select jsonb_array_elements_text(player_ids));

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into contracts
    from jsonb_each(coalesce(squad_cycle -> 'contracts', '{}'::jsonb)) entry
   where entry.key in (
     select value ->> 'contract_id'
       from jsonb_each(players)
      where coalesce(value ->> 'contract_id', '') <> ''
   );

  select coalesce(jsonb_agg(entry.value), '[]'::jsonb)
    into player_ownership
    from jsonb_array_elements(coalesce(squad_cycle -> 'player_ownership', world -> 'player_ownership', '[]'::jsonb)) entry(value)
   where coalesce(entry.value ->> 'tbg_player_id', entry.value ->> 'player_id', entry.value ->> 'id')
         in (select jsonb_array_elements_text(player_ids));

  select value
    into division
    from jsonb_array_elements(coalesce(world -> 'competition' -> 'divisions', '[]'::jsonb)) value
   where coalesce(value -> 'club_ids', '[]'::jsonb) ? p_club_id
   limit 1;

  division_id := division ->> 'division_id';
  runtime := case when division_id is null then null else world -> 'matchday_cycle' -> 'runtimes' -> division_id end;

  if runtime is not null then
    -- Portal fixture/form views need only fixture + score, never full commentary/statistics payloads.
    select coalesce(jsonb_agg(jsonb_build_object('fixture', row.value -> 'fixture', 'score', row.value -> 'score')), '[]'::jsonb)
      into compact_archive_results
      from jsonb_array_elements(coalesce(runtime -> 'archive_results', '[]'::jsonb)) row(value);

    select coalesce(jsonb_agg(jsonb_build_object('fixture', row.value -> 'fixture', 'score', row.value -> 'score')), '[]'::jsonb)
      into compact_results
      from jsonb_array_elements(coalesce(runtime -> 'results', '[]'::jsonb)) row(value);

    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      into runtime_players
      from jsonb_each(coalesce(runtime -> 'state' -> 'players', '{}'::jsonb)) entry
     where entry.key in (select jsonb_array_elements_text(player_ids));

    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      into runtime_availability_players
      from jsonb_each(coalesce(runtime -> 'state' -> 'availability' -> 'players', '{}'::jsonb)) entry
     where entry.key in (select jsonb_array_elements_text(player_ids));

    slim_runtime := jsonb_build_object(
      'fixtures', coalesce(runtime -> 'fixtures', '[]'::jsonb),
      'archive_results', compact_archive_results,
      'results', compact_results,
      'table', coalesce(runtime -> 'table', '{}'::jsonb),
      'state', jsonb_build_object(
        'players', runtime_players,
        'availability', jsonb_build_object('players', runtime_availability_players)
      )
    );
  end if;

  fragment := jsonb_build_object(
    'version', world -> 'version',
    'world_id', world -> 'world_id',
    'display_name', world -> 'display_name',
    'phase', world -> 'phase',
    'clock', world -> 'clock',
    'season_number', world -> 'season_number',
    'rules', coalesce(world -> 'rules', '{}'::jsonb),
    'loan_rules', coalesce(world -> 'loan_rules', '{}'::jsonb),
    'competition_rules', coalesce(world -> 'competition_rules', '{}'::jsonb),
    'club_profiles', coalesce(world -> 'club_profiles', '{}'::jsonb),
    'competition', jsonb_build_object(
      'divisions', case when division is null then '[]'::jsonb else jsonb_build_array(division) end,
      'competitions', coalesce(world -> 'competition' -> 'competitions', '[]'::jsonb)
    ),
    'squad_cycle', jsonb_build_object(
      'season_id', squad_cycle -> 'season_id',
      'registration_limit', squad_cycle -> 'registration_limit',
      'clubs', jsonb_build_object(p_club_id, club),
      'players', players,
      'contracts', contracts,
      'player_ownership', player_ownership,
      'state', jsonb_build_object('registrations', coalesce(squad_cycle -> 'state' -> 'registrations', '{}'::jsonb))
    ),
    'matchday_cycle', jsonb_build_object(
      'current_matchday', world -> 'matchday_cycle' -> 'current_matchday',
      'maximum_matchday', world -> 'matchday_cycle' -> 'maximum_matchday',
      'turn_calendar', coalesce(world -> 'matchday_cycle' -> 'turn_calendar', '{}'::jsonb),
      'runtimes', case when division_id is null or slim_runtime is null then '{}'::jsonb else jsonb_build_object(division_id, slim_runtime) end
    ),
    'player_ownership', player_ownership
  );

  insert into public.manager_portal_fragment_cache(world_id, club_id, source_checksum, fragment, refreshed_at)
  values (p_world_id, p_club_id, stored_checksum, fragment, now())
  on conflict (world_id, club_id) do update
    set source_checksum = excluded.source_checksum,
        fragment = excluded.fragment,
        refreshed_at = excluded.refreshed_at;

  return jsonb_build_object(
    'world_id', p_world_id,
    'save_checksum', stored_checksum,
    'season_id', stored_season_id,
    'season_number', stored_season_number,
    'phase', stored_phase,
    'matchday', stored_matchday,
    'next_turn_at', stored_next_turn_at,
    'turn_status', stored_turn_status,
    'created_at', stored_created_at,
    'updated_at', stored_updated_at,
    'world', fragment
  );
end;
$function$;

create or replace function public.get_manager_transfer_directory_for_user(p_user_id uuid, p_world_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  stored_checksum text;
  stored_turn_status text;
  stored_updated_at timestamptz;
  envelope jsonb;
  world jsonb;
  squad_cycle jsonb;
  appointed_club_id text;
  cached_directory jsonb;
  clubs jsonb := '[]'::jsonb;
  players jsonb := '[]'::jsonb;
  decorated_clubs jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  select appointment.club_id
    into appointed_club_id
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
   where profile.user_id = p_user_id
   limit 1;
  if appointed_club_id is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  -- Cache hits read only canonical metadata; the large save envelope remains untouched.
  select save_checksum, turn_status, updated_at
    into stored_checksum, stored_turn_status, stored_updated_at
    from public.canonical_world_saves
   where world_id = p_world_id
   limit 1;
  if not found then return null; end if;

  select cache.directory
    into cached_directory
    from public.manager_transfer_directory_cache cache
   where cache.world_id = p_world_id
     and cache.source_checksum = stored_checksum;

  if cached_directory is null then
    select save_envelope
      into envelope
      from public.canonical_world_saves
     where world_id = p_world_id
       and save_checksum = stored_checksum
     limit 1;
    if envelope is null then
      raise exception 'Canonical world % changed while building transfer directory', p_world_id;
    end if;
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
        else null end
    ) order by coalesce(squad_cycle -> 'players' -> owned.player_id ->> 'display_name', squad_cycle -> 'players' -> owned.player_id ->> 'player_name', squad_cycle -> 'players' -> owned.player_id ->> 'name', owned.player_id)), '[]'::jsonb)
      into players
      from owned
     where squad_cycle -> 'players' ? owned.player_id;

    cached_directory := jsonb_build_object('clubs', clubs, 'players', players);
    insert into public.manager_transfer_directory_cache(world_id, source_checksum, directory, refreshed_at)
    values (p_world_id, stored_checksum, cached_directory, now())
    on conflict (world_id) do update
      set source_checksum = excluded.source_checksum,
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
$function$;

revoke all on function public.get_manager_portal_world_fragment(text, text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_directory_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.get_manager_portal_world_fragment(text, text) to service_role;
grant execute on function public.get_manager_transfer_directory_for_user(uuid, text) to service_role;
