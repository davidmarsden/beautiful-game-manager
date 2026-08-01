-- Move transfer directory, inbox and response RPCs behind trusted Netlify gateways.
-- Netlify verifies the browser bearer token with Supabase Auth, then passes only
-- that verified user ID to these service-role-only functions. PostgreSQL derives
-- the manager and active appointment before delegating to the existing logic.

begin;

create or replace function public.get_managed_transfer_clubs_for_user(
  p_user_id uuid,
  p_world_id text
) returns table(club_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  if not exists (
    select 1
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
    where profile.user_id = p_user_id
  ) then
    raise exception 'No active manager appointment for this user and world';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);

  return query
    select managed.club_id
    from public.get_managed_transfer_clubs(p_world_id) managed;
end;
$$;

create or replace function public.get_manager_transfer_inbox_for_user(
  p_user_id uuid,
  p_world_id text
) returns setof public.manager_world_commands
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  if not exists (
    select 1
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
    where profile.user_id = p_user_id
  ) then
    raise exception 'No active manager appointment for this user and world';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);

  return query
    select inbox.*
    from public.get_manager_transfer_inbox(p_world_id) inbox;
end;
$$;

create or replace function public.submit_manager_transfer_response_for_user(
  p_user_id uuid,
  p_world_id text,
  p_proposal_id uuid,
  p_response text,
  p_request_key text
) returns public.manager_world_commands
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  if not exists (
    select 1
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
    where profile.user_id = p_user_id
  ) then
    raise exception 'No active manager appointment for this user and world';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);

  return public.submit_manager_transfer_response(
    p_world_id,
    p_proposal_id,
    p_response,
    p_request_key
  );
end;
$$;

-- Existing implementation RPCs are no longer direct Data API endpoints.
revoke all on function public.get_managed_transfer_clubs(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_manager_transfer_inbox(text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_manager_transfer_response(text, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Only trusted server-side code can enter the gateways.
revoke all on function public.get_managed_transfer_clubs_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_managed_transfer_clubs_for_user(uuid, text)
  to service_role;

revoke all on function public.get_manager_transfer_inbox_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_inbox_for_user(uuid, text)
  to service_role;

revoke all on function public.submit_manager_transfer_response_for_user(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_manager_transfer_response_for_user(uuid, text, uuid, text, text)
  to service_role;

-- Fail closed if direct browser access or missing gateway access drifts.
do $security_assertions$
begin
  if has_function_privilege('authenticated',
    'public.get_managed_transfer_clubs(text)', 'execute') then
    raise exception 'authenticated can still execute get_managed_transfer_clubs directly';
  end if;

  if has_function_privilege('authenticated',
    'public.get_manager_transfer_inbox(text)', 'execute') then
    raise exception 'authenticated can still execute get_manager_transfer_inbox directly';
  end if;

  if has_function_privilege('authenticated',
    'public.submit_manager_transfer_response(text,uuid,text,text)', 'execute') then
    raise exception 'authenticated can still execute submit_manager_transfer_response directly';
  end if;

  if not has_function_privilege('service_role',
    'public.get_managed_transfer_clubs_for_user(uuid,text)', 'execute') then
    raise exception 'service_role lost managed transfer clubs gateway access';
  end if;

  if not has_function_privilege('service_role',
    'public.get_manager_transfer_inbox_for_user(uuid,text)', 'execute') then
    raise exception 'service_role lost transfer inbox gateway access';
  end if;

  if not has_function_privilege('service_role',
    'public.submit_manager_transfer_response_for_user(uuid,text,uuid,text,text)', 'execute') then
    raise exception 'service_role lost transfer response gateway access';
  end if;
end
$security_assertions$;

commit;
