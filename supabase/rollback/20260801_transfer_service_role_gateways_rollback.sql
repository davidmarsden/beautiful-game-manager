-- Emergency rollback for 20260801_transfer_service_role_gateways.sql.
-- Restores the pre-gateway authenticated API grants captured on 2026-08-01.

begin;

drop function if exists public.submit_manager_transfer_response_for_user(
  uuid, text, uuid, text, text
);
drop function if exists public.get_manager_transfer_inbox_for_user(uuid, text);
drop function if exists public.get_managed_transfer_clubs_for_user(uuid, text);

revoke all on function public.get_managed_transfer_clubs(text)
  from public, anon;
grant execute on function public.get_managed_transfer_clubs(text)
  to authenticated, service_role;

revoke all on function public.get_manager_transfer_inbox(text)
  from public, anon;
grant execute on function public.get_manager_transfer_inbox(text)
  to authenticated, service_role;

revoke all on function public.submit_manager_transfer_response(text, uuid, text, text)
  from public, anon;
grant execute on function public.submit_manager_transfer_response(text, uuid, text, text)
  to authenticated, service_role;

commit;
