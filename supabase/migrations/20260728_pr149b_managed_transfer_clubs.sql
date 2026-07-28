-- PR #149 follow-up: expose only active human-managed clubs as bilateral offer targets.

begin;

create or replace function public.get_managed_transfer_clubs(p_world_id text)
returns table (club_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.manager_appointments appointment
    where appointment.manager_id = public.current_manager_id()
      and appointment.world_id = p_world_id
      and appointment.status = 'active'
  ) then
    raise exception 'No active club appointment for this world';
  end if;

  return query
  select distinct appointment.club_id
  from public.manager_appointments appointment
  where appointment.world_id = p_world_id
    and appointment.status = 'active'
  order by appointment.club_id;
end;
$$;

revoke all on function public.get_managed_transfer_clubs(text) from public, anon;
grant execute on function public.get_managed_transfer_clubs(text) to authenticated;

commit;
