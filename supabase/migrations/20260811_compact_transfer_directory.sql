-- Replace the transfer UI's full canonical save read with a compact, server-only
-- projection containing only actively managed clubs and their owned players.
-- Netlify verifies the browser session, then passes the verified user id here.

begin;

create or replace function public.get_manager_transfer_directory_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  stored public.canonical_world_saves%rowtype;
  envelope jsonb;
  world jsonb;
  squad_cycle jsonb;
  appointed_club_id text;
  clubs jsonb := '[]'::jsonb;
  players jsonb := '[]'::jsonb;
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

  select *
    into stored
    from public.canonical_world_saves
   where world_id = p_world_id
   limit 1;

  if not found then
    return null;
  end if;

  envelope := stored.save_envelope;
  if coalesce(envelope ->> 'save_version', '') <> 'tbg-playable-world-save-v1.0'
     or coalesce(envelope ->> 'checksum', '') = ''
     or stored.save_checksum <> envelope ->> 'checksum' then
    raise exception 'Canonical save metadata mismatch for world %', p_world_id;
  end if;

  world := envelope -> 'world';
  if world is null
     or jsonb_typeof(world) <> 'object'
     or coalesce(world ->> 'world_id', '') <> p_world_id
     or jsonb_typeof(world -> 'squad_cycle') <> 'object' then
    raise exception 'Canonical world % failed transfer-directory integrity validation', p_world_id;
  end if;

  squad_cycle := world -> 'squad_cycle';

  with managed as (
    select distinct appointment.club_id
      from public.manager_appointments appointment
     where appointment.world_id = p_world_id
       and appointment.status = 'active'
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'club_id', managed.club_id,
      'club_name', coalesce(
        world -> 'club_profiles' -> managed.club_id ->> 'club_name',
        world -> 'club_profiles' -> managed.club_id ->> 'canonical_name',
        managed.club_id
      ),
      'appointed', managed.club_id = appointed_club_id,
      'managed', true
    ) order by coalesce(
      world -> 'club_profiles' -> managed.club_id ->> 'club_name',
      world -> 'club_profiles' -> managed.club_id ->> 'canonical_name',
      managed.club_id
    )
  ), '[]'::jsonb)
    into clubs
    from managed
   where squad_cycle -> 'clubs' ? managed.club_id;

  with managed as (
    select distinct appointment.club_id
      from public.manager_appointments appointment
     where appointment.world_id = p_world_id
       and appointment.status = 'active'
  ), owned as (
    select managed.club_id, player_id
      from managed
      cross join lateral jsonb_array_elements_text(
        coalesce(squad_cycle -> 'clubs' -> managed.club_id -> 'player_ids', '[]'::jsonb)
      ) player_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id', owned.player_id,
      'player_name', coalesce(
        squad_cycle -> 'players' -> owned.player_id ->> 'display_name',
        squad_cycle -> 'players' -> owned.player_id ->> 'player_name',
        squad_cycle -> 'players' -> owned.player_id ->> 'name',
        owned.player_id
      ),
      'club_id', owned.club_id,
      'club_name', coalesce(
        world -> 'club_profiles' -> owned.club_id ->> 'club_name',
        world -> 'club_profiles' -> owned.club_id ->> 'canonical_name',
        owned.club_id
      ),
      'position', coalesce(
        squad_cycle -> 'players' -> owned.player_id ->> 'specific_position',
        squad_cycle -> 'players' -> owned.player_id ->> 'primary_position',
        squad_cycle -> 'players' -> owned.player_id ->> 'position',
        '—'
      ),
      'rating', case
        when coalesce(
          squad_cycle -> 'players' -> owned.player_id ->> 'underlying_ability_rating',
          squad_cycle -> 'players' -> owned.player_id ->> 'tbg_rating',
          squad_cycle -> 'players' -> owned.player_id ->> 'rating',
          ''
        ) ~ '^-?[0-9]+(\\.[0-9]+)?$'
        then coalesce(
          squad_cycle -> 'players' -> owned.player_id ->> 'underlying_ability_rating',
          squad_cycle -> 'players' -> owned.player_id ->> 'tbg_rating',
          squad_cycle -> 'players' -> owned.player_id ->> 'rating'
        )::numeric
        else null
      end
    ) order by coalesce(
      squad_cycle -> 'players' -> owned.player_id ->> 'display_name',
      squad_cycle -> 'players' -> owned.player_id ->> 'player_name',
      squad_cycle -> 'players' -> owned.player_id ->> 'name',
      owned.player_id
    )
  ), '[]'::jsonb)
    into players
    from owned
   where squad_cycle -> 'players' ? owned.player_id;

  return jsonb_build_object(
    'world_id', stored.world_id,
    'save_checksum', stored.save_checksum,
    'turn_status', stored.turn_status,
    'updated_at', stored.updated_at,
    'directory', jsonb_build_object(
      'clubs', clubs,
      'players', players
    )
  );
end;
$$;

revoke all on function public.get_manager_transfer_directory_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_directory_for_user(uuid, text)
  to service_role;

do $security_assertions$
begin
  if has_function_privilege('authenticated',
    'public.get_manager_transfer_directory_for_user(uuid,text)', 'execute') then
    raise exception 'authenticated can execute compact transfer directory directly';
  end if;

  if not has_function_privilege('service_role',
    'public.get_manager_transfer_directory_for_user(uuid,text)', 'execute') then
    raise exception 'service_role lost compact transfer directory access';
  end if;
end
$security_assertions$;

commit;
