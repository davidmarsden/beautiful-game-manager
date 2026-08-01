-- Restore the pre-PR current_manager_id() privilege model.

begin;

create or replace function public.current_manager_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.manager_profiles
  where user_id = auth.uid()
  limit 1
$$;

revoke all on function public.current_manager_id() from public, anon;
grant execute on function public.current_manager_id() to authenticated, service_role;

commit;
