-- TBG Supabase least-privilege baseline.
-- Captured and validated against project edarvglbzuefveqcjpdt on 2026-08-01.
-- A manual logical backup must exist before this migration is applied.

begin;

-- Future objects created by postgres in the exposed public schema must be
-- explicitly published rather than inheriting broad Data API privileges.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- RLS helper: signed-in users need this for existing policies; anonymous users
-- do not. SECURITY DEFINER remains necessary because manager_profiles is RLS
-- protected, but the function derives identity exclusively from auth.uid().
revoke all on function public.current_manager_id() from public, anon;
grant execute on function public.current_manager_id() to authenticated, service_role;

-- The portal world fragment is fetched by trusted Netlify functions using the
-- service role. It must not be callable directly through PostgREST.
revoke all on function public.get_manager_portal_world_fragment(text, text)
  from public, anon, authenticated;
grant execute on function public.get_manager_portal_world_fragment(text, text)
  to service_role;

-- Trigger and maintenance functions execute through their trigger/scheduler
-- paths. Remove their accidental public RPC surfaces.
revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to service_role;

revoke all on function public.lock_expired_manager_submissions()
  from public, anon, authenticated;
grant execute on function public.lock_expired_manager_submissions() to service_role;

revoke all on function public.propagate_transfer_response_outcome()
  from public, anon, authenticated;
grant execute on function public.propagate_transfer_response_outcome() to service_role;

-- rls_auto_enable() exists in the live project but is absent from the tracked
-- migration history. Harden it when present without breaking fresh rebuilds.
do $optional_rls_auto_enable$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end
$optional_rls_auto_enable$;

-- Fix mutable search_path advisories on deterministic helper functions.
alter function public.manager_command_subject_key(text, jsonb)
  set search_path = pg_catalog;

alter function public.tbg_canonical_jsonb_text(jsonb)
  set search_path = pg_catalog, public;

-- match_runs is internal engine state. RLS already denies ordinary roles
-- because no policies exist; revoke the underlying table grants as well.
revoke all on table public.match_runs from anon, authenticated;

-- manager_profiles is readable only through its existing own-row RLS policy.
-- Remove anonymous ambient grants and constrain signed-in UPDATE privileges to
-- user-editable profile fields. Identity, email, status and admin state remain
-- service-controlled.
revoke all on table public.manager_profiles from anon;
revoke all on table public.manager_profiles from authenticated;
grant select on table public.manager_profiles to authenticated;
grant update (
  display_name,
  country,
  timezone,
  favourite_club,
  profile_completed,
  updated_at
) on table public.manager_profiles to authenticated;

-- Migration-time assertions. Any future signature or privilege drift should
-- fail the migration rather than silently producing a partial baseline.
do $security_assertions$
begin
  if has_function_privilege('anon', 'public.current_manager_id()', 'execute') then
    raise exception 'anon can still execute current_manager_id()';
  end if;

  if not has_function_privilege('authenticated', 'public.current_manager_id()', 'execute') then
    raise exception 'authenticated lost required current_manager_id() access';
  end if;

  if has_function_privilege('anon', 'public.get_manager_portal_world_fragment(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.get_manager_portal_world_fragment(text,text)', 'execute') then
    raise exception 'manager portal world fragment remains exposed to ordinary API roles';
  end if;

  if not has_function_privilege('service_role', 'public.get_manager_portal_world_fragment(text,text)', 'execute') then
    raise exception 'service_role lost manager portal world fragment access';
  end if;

  if has_table_privilege('anon', 'public.manager_profiles', 'select')
     or has_table_privilege('anon', 'public.manager_profiles', 'update') then
    raise exception 'anon retains manager_profiles privileges';
  end if;

  if has_column_privilege('authenticated', 'public.manager_profiles', 'is_admin', 'update')
     or has_column_privilege('authenticated', 'public.manager_profiles', 'status', 'update')
     or has_column_privilege('authenticated', 'public.manager_profiles', 'user_id', 'update') then
    raise exception 'authenticated can update protected manager profile fields';
  end if;

  if not has_column_privilege('authenticated', 'public.manager_profiles', 'display_name', 'update') then
    raise exception 'authenticated lost editable manager profile access';
  end if;

  if has_table_privilege('anon', 'public.match_runs', 'select')
     or has_table_privilege('authenticated', 'public.match_runs', 'select') then
    raise exception 'ordinary API roles retain match_runs access';
  end if;
end
$security_assertions$;

commit;
