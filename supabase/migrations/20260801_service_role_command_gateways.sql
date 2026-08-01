-- Move manager command writes behind trusted Netlify service-role gateways.
-- The browser-facing functions remain as implementation details but lose all
-- direct API grants. Each gateway receives the user ID already verified by the
-- Netlify function, derives manager and club identity in PostgreSQL, establishes
-- the matching auth.uid() context, then delegates to the existing tested RPC.

begin;

create or replace function public.submit_manager_world_command_for_user(
  p_user_id uuid,
  p_world_id text,
  p_command_type text,
  p_command_payload jsonb,
  p_effective_season_id text,
  p_effective_matchday integer,
  p_request_key text
) returns public.manager_world_commands
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  select profile.id, appointment.club_id
  into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null or club_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);

  return public.submit_manager_world_command(
    p_world_id,
    manager_id_value,
    club_id_value,
    p_command_type,
    p_command_payload,
    p_effective_season_id,
    p_effective_matchday,
    p_request_key
  );
end;
$$;

create or replace function public.submit_bulk_registration_commands_for_user(
  p_user_id uuid,
  p_world_id text,
  p_requested_player_ids text[],
  p_current_registered_ids text[],
  p_owned_senior_ids text[],
  p_registration_limit integer,
  p_effective_season_id text,
  p_effective_matchday integer,
  p_batch_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  select profile.id, appointment.club_id
  into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null or club_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);

  return public.submit_bulk_registration_commands(
    p_world_id,
    manager_id_value,
    club_id_value,
    p_requested_player_ids,
    p_current_registered_ids,
    p_owned_senior_ids,
    p_registration_limit,
    p_effective_season_id,
    p_effective_matchday,
    p_batch_id
  );
end;
$$;

-- Existing implementation RPCs are no longer direct browser APIs.
revoke all on function public.submit_manager_world_command(
  text, uuid, text, text, jsonb, text, integer, text
) from public, anon, authenticated, service_role;

revoke all on function public.submit_bulk_registration_commands(
  text, uuid, text, text[], text[], text[], integer, text, integer, text
) from public, anon, authenticated, service_role;

-- Only trusted server-side code can enter the new gateways.
revoke all on function public.submit_manager_world_command_for_user(
  uuid, text, text, jsonb, text, integer, text
) from public, anon, authenticated;
grant execute on function public.submit_manager_world_command_for_user(
  uuid, text, text, jsonb, text, integer, text
) to service_role;

revoke all on function public.submit_bulk_registration_commands_for_user(
  uuid, text, text[], text[], text[], integer, text, integer, text
) from public, anon, authenticated;
grant execute on function public.submit_bulk_registration_commands_for_user(
  uuid, text, text[], text[], text[], integer, text, integer, text
) to service_role;

-- Fail closed if any direct browser execution remains.
do $security_assertions$
begin
  if has_function_privilege('authenticated',
    'public.submit_manager_world_command(text,uuid,text,text,jsonb,text,integer,text)', 'execute') then
    raise exception 'authenticated can still execute submit_manager_world_command directly';
  end if;

  if has_function_privilege('authenticated',
    'public.submit_bulk_registration_commands(text,uuid,text,text[],text[],text[],integer,text,integer,text)', 'execute') then
    raise exception 'authenticated can still execute submit_bulk_registration_commands directly';
  end if;

  if not has_function_privilege('service_role',
    'public.submit_manager_world_command_for_user(uuid,text,text,jsonb,text,integer,text)', 'execute') then
    raise exception 'service_role lost command gateway access';
  end if;

  if not has_function_privilege('service_role',
    'public.submit_bulk_registration_commands_for_user(uuid,text,text[],text[],text[],integer,text,integer,text)', 'execute') then
    raise exception 'service_role lost bulk registration gateway access';
  end if;
end
$security_assertions$;

commit;
