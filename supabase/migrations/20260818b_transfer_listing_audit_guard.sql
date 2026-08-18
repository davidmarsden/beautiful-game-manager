-- #240: withdrawal is a state transition; service code must not delete listing/audit history.

begin;

revoke delete on table public.transfer_market_listings from service_role;
revoke update, delete on table public.transfer_market_listing_events from service_role;

do $audit_guard$
begin
  if has_table_privilege('service_role', 'public.transfer_market_listings', 'delete') then
    raise exception 'service_role can delete transfer-market listing history';
  end if;
  if has_table_privilege('service_role', 'public.transfer_market_listing_events', 'update')
     or has_table_privilege('service_role', 'public.transfer_market_listing_events', 'delete') then
    raise exception 'service_role can mutate transfer-market listing audit events';
  end if;
end
$audit_guard$;

commit;
