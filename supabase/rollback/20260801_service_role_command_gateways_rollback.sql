-- Emergency rollback for 20260801_service_role_command_gateways.sql.
-- Restores the previous authenticated RPC surface so the pre-change Netlify
-- functions can operate while a gateway deployment problem is investigated.

begin;

revoke all on function public.submit_manager_world_command_for_user(
  uuid, text, text, jsonb, text, integer, text
) from public, anon, authenticated, service_role;

revoke all on function public.submit_bulk_registration_commands_for_user(
  uuid, text, text[], text[], text[], integer, text, integer, text
) from public, anon, authenticated, service_role;

-- Restore the previous direct authenticated execution grants.
revoke all on function public.submit_manager_world_command(
  text, uuid, text, text, jsonb, text, integer, text
) from public, anon, service_role;
grant execute on function public.submit_manager_world_command(
  text, uuid, text, text, jsonb, text, integer, text
) to authenticated;

revoke all on function public.submit_bulk_registration_commands(
  text, uuid, text, text[], text[], text[], integer, text, integer, text
) from public, anon, service_role;
grant execute on function public.submit_bulk_registration_commands(
  text, uuid, text, text[], text[], text[], integer, text, integer, text
) to authenticated;

commit;
