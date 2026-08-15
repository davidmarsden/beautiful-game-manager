-- Active manager appointments can change without a canonical world checkpoint.
-- Include a cheap relational fingerprint in the transfer-directory cache key.

alter table public.manager_transfer_directory_cache
  add column if not exists appointment_fingerprint text;

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

  select md5(coalesce(string_agg(appointment.manager_id::text || ':' || appointment.club_id, ',' order by appointment.manager_id::text, appointment.club_id), ''))
    into current_appointment_fingerprint
    from public.manager_appointments appointment
   where appointment.world_id = p_world_id
     and appointment.status = 'active';

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
     and cache.source_checksum = stored_checksum
     and cache.appointment_fingerprint = current_appointment_fingerprint;

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
$function$;

revoke all on function public.get_manager_transfer_directory_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_directory_for_user(uuid, text) to service_role;
