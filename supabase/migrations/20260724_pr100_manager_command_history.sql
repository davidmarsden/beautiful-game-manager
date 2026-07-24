-- PR #100: observable manager command status, outcomes and history.

alter table public.manager_world_commands
  add column if not exists outcome_reason text,
  add column if not exists outcome_details jsonb not null default '{}'::jsonb,
  add column if not exists superseded_by uuid references public.manager_world_commands(id) on delete set null;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.manager_world_commands'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if constraint_name is not null then
    execute format('alter table public.manager_world_commands drop constraint %I', constraint_name);
  end if;

  alter table public.manager_world_commands
    add constraint manager_world_commands_status_check
    check (status in ('pending','accepted','rejected','cancelled','applied','superseded'));
end $$;

create index if not exists manager_world_commands_history_idx
  on public.manager_world_commands(manager_id, submitted_at desc, id desc);

comment on column public.manager_world_commands.outcome_reason is
  'Manager-facing explanation for acceptance, rejection, application or supersession.';
comment on column public.manager_world_commands.outcome_details is
  'Structured immutable processing result retained for operational and manager-facing history.';
comment on column public.manager_world_commands.superseded_by is
  'Newer command that replaced this request before processing.';
