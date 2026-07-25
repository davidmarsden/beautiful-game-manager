-- PR #115 prerequisite: stable message deduplication metadata.
begin;
alter table public.manager_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;
commit;
