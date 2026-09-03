begin;

create or replace function public.manager_notification_delivery_category(p_notification_type text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when coalesce(p_notification_type, '') like 'transfer_%'
      or coalesce(p_notification_type, '') like 'free_agent_%' then 'transfers'
    when coalesce(p_notification_type, '') like 'news_%' then 'social'
    else 'system'
  end;
$$;

revoke all on function public.manager_notification_delivery_category(text) from public, anon, authenticated;
grant execute on function public.manager_notification_delivery_category(text) to service_role;

comment on function public.manager_notification_delivery_category(text) is
  'Maps manager notification types onto external delivery preference buckets. Transfer and free-agent activity share the Transfers preference.';

commit;
