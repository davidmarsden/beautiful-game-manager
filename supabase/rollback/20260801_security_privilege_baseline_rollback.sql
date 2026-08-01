-- Emergency rollback for 20260801_security_privilege_baseline.sql.
-- This intentionally restores the insecure pre-baseline privilege state
-- observed on 2026-08-01. Use only to recover application availability, then
-- investigate and re-apply a corrected least-privilege migration.

begin;

-- Restore observed postgres default privileges in public.
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Restore observed function execute privileges.
grant execute on function public.current_manager_id()
  to public, anon, authenticated, service_role;

grant execute on function public.get_manager_portal_world_fragment(text, text)
  to public, anon, authenticated, service_role;

grant execute on function public.handle_new_auth_user()
  to public, anon, authenticated, service_role;

grant execute on function public.lock_expired_manager_submissions()
  to public, anon, authenticated, service_role;

grant execute on function public.propagate_transfer_response_outcome()
  to public, anon, authenticated, service_role;

grant execute on function public.rls_auto_enable()
  to public, anon, authenticated, service_role;

-- Restore mutable helper configuration observed before the baseline.
alter function public.manager_command_subject_key(text, jsonb) reset all;
alter function public.tbg_canonical_jsonb_text(jsonb) reset all;
alter function public.rls_auto_enable() set search_path = pg_catalog;

-- Restore broad table privileges observed before the baseline.
grant all on table public.match_runs to anon, authenticated, service_role;
grant all on table public.manager_profiles to anon, authenticated, service_role;

commit;
