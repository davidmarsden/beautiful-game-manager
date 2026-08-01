-- current_manager_id() only reads the caller's own manager profile.
-- manager_profiles already enforces user_id = auth.uid() through RLS, so the
-- helper does not need owner privileges or an RLS bypass.

begin;

create or replace function public.current_manager_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog, public, auth
as $$
  select profile.id
  from public.manager_profiles profile
  where profile.user_id = (select auth.uid())
  limit 1
$$;

revoke all on function public.current_manager_id() from public, anon;
grant execute on function public.current_manager_id() to authenticated, service_role;

do $security_assertions$
declare
  is_security_definer boolean;
begin
  select procedure.prosecdef
  into is_security_definer
  from pg_catalog.pg_proc procedure
  where procedure.oid = 'public.current_manager_id()'::regprocedure;

  if is_security_definer then
    raise exception 'current_manager_id must run as SECURITY INVOKER';
  end if;

  if not has_function_privilege('authenticated',
    'public.current_manager_id()', 'execute') then
    raise exception 'authenticated lost current_manager_id access required by RLS policies';
  end if;

  if has_function_privilege('anon',
    'public.current_manager_id()', 'execute') then
    raise exception 'anon can execute current_manager_id';
  end if;
end
$security_assertions$;

commit;
