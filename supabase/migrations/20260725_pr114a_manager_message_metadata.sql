-- PR #115 prerequisite: durable idempotency metadata for manager command messages.

alter table public.manager_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.manager_messages.metadata is
  'Structured message context, including idempotent command outcome keys.';
