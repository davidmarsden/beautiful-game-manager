-- PR #81: TBG is one shared, centrally advanced world.
-- Do not deploy the PR #78 per-manager-save migration. This migration removes that model if present.
-- This file is deliberately standalone: it also creates the PR #79 operational tables when absent.

create extension if not exists pgcrypto;

drop table if exists public.persistent_world_saves cascade;

create table if not exists public.canonical_world_saves (
  world_id text primary key,
  save_version text not null,
  save_checksum text not null,
  save_envelope jsonb not null,
  season_id text,
  season_number integer,
  phase text,
  matchday integer,
  next_turn_at timestamptz,
  turn_status text not null default 'open' check (turn_status in ('open','locking','processing','complete','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_turn_submissions (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.canonical_world_saves(world_id) on delete cascade,
  season_id text not null,
  matchday integer not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  instruction jsonb not null default '{}'::jsonb,
  status text not null default 'submitted' check (status in ('draft','submitted','locked','consumed','superseded')),
  submitted_at timestamptz not null default now(),
  locked_at timestamptz,
  consumed_at timestamptz,
  unique (world_id, season_id, matchday, club_id)
);

create table if not exists public.manager_world_commands (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.canonical_world_saves(world_id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  command_type text not null check (command_type in ('register_player','unregister_player','renew_contract','transfer_offer','transfer_listing','transfer_response')),
  command_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled','applied')),
  effective_season_id text,
  effective_matchday integer,
  submitted_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.world_turn_runs (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.canonical_world_saves(world_id) on delete cascade,
  season_id text not null,
  matchday integer not null,
  previous_checksum text not null,
  next_checksum text,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('processing','complete','failed','skipped')),
  submission_count integer not null default 0,
  fallback_count integer not null default 0,
  error_message text,
  unique (world_id, season_id, matchday)
);

-- Operational safety tables from PR #79, now world-scoped rather than manager-save-scoped.
create table if not exists public.persistent_world_backups (
  id uuid primary key default gen_random_uuid(),
  backup_id text not null unique,
  world_id text not null,
  manager_id uuid references public.manager_profiles(id) on delete set null,
  club_id text,
  save_version text not null,
  save_checksum text not null,
  save_envelope jsonb not null,
  source_save_updated_at timestamptz,
  source text not null check (source in ('manual','scheduled','pre_restore','pre_rollback','pre_reset','incident')),
  reason text not null,
  season_id text,
  season_number integer,
  phase text,
  matchday integer,
  created_by uuid references public.manager_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references public.manager_profiles(id) on delete set null
);

create table if not exists public.world_operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique,
  operation_type text not null check (operation_type in ('backup','restore','rollback','reset','monitor')),
  world_id text not null,
  manager_id uuid references public.manager_profiles(id) on delete set null,
  club_id text,
  source_backup_id text,
  previous_checksum text,
  replacement_checksum text,
  status text not null check (status in ('accepted','rejected','failed')),
  details jsonb not null default '{}'::jsonb,
  requested_by uuid references public.manager_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.world_operation_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_id text not null unique,
  world_id text not null,
  manager_id uuid references public.manager_profiles(id) on delete set null,
  club_id text,
  severity text not null check (severity in ('warning','critical')),
  source text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

-- Upgrade installations where PR #79 had already created manager-owned backup columns.
alter table if exists public.persistent_world_backups alter column manager_id drop not null;
alter table if exists public.persistent_world_backups alter column club_id drop not null;

drop index if exists public.persistent_world_backups_lookup_idx;
create index if not exists persistent_world_backups_world_idx on public.persistent_world_backups(world_id, created_at desc);
create index if not exists world_operation_events_lookup_idx on public.world_operation_events(world_id, created_at desc);
create index if not exists world_operation_alerts_open_idx on public.world_operation_alerts(world_id, status, created_at desc);
create index if not exists manager_turn_submissions_manager_idx on public.manager_turn_submissions(manager_id, submitted_at desc);
create index if not exists manager_world_commands_manager_idx on public.manager_world_commands(manager_id, submitted_at desc);
create index if not exists canonical_world_due_idx on public.canonical_world_saves(turn_status, next_turn_at);

alter table public.canonical_world_saves enable row level security;
alter table public.manager_turn_submissions enable row level security;
alter table public.manager_world_commands enable row level security;
alter table public.world_turn_runs enable row level security;
alter table public.persistent_world_backups enable row level security;
alter table public.world_operation_events enable row level security;
alter table public.world_operation_alerts enable row level security;

-- Drop named policies first so the migration can safely be rerun after a partial/manual attempt.
drop policy if exists "Authenticated managers can read canonical worlds" on public.canonical_world_saves;
drop policy if exists "Managers can read their turn submissions" on public.manager_turn_submissions;
drop policy if exists "Managers can create their appointed turn submissions" on public.manager_turn_submissions;
drop policy if exists "Managers can update their appointed unlocked turn submissions" on public.manager_turn_submissions;
drop policy if exists "Managers can read their world commands" on public.manager_world_commands;
drop policy if exists "Managers can submit appointed world commands" on public.manager_world_commands;
drop policy if exists "Authenticated managers can read turn runs" on public.world_turn_runs;
drop policy if exists "admins read world backups" on public.persistent_world_backups;
drop policy if exists "admins create world backups" on public.persistent_world_backups;
drop policy if exists "admins update world backups" on public.persistent_world_backups;
drop policy if exists "admins read operation events" on public.world_operation_events;
drop policy if exists "admins create operation events" on public.world_operation_events;
drop policy if exists "admins read operation alerts" on public.world_operation_alerts;
drop policy if exists "admins manage operation alerts" on public.world_operation_alerts;

create policy "Authenticated managers can read canonical worlds"
  on public.canonical_world_saves for select to authenticated using (true);

create policy "Managers can read their turn submissions"
  on public.manager_turn_submissions for select to authenticated
  using (manager_id in (select id from public.manager_profiles where user_id = auth.uid()));
create policy "Managers can create their appointed turn submissions"
  on public.manager_turn_submissions for insert to authenticated
  with check (
    manager_id in (select id from public.manager_profiles where user_id = auth.uid())
    and exists (
      select 1 from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  );
create policy "Managers can update their appointed unlocked turn submissions"
  on public.manager_turn_submissions for update to authenticated
  using (
    manager_id in (select id from public.manager_profiles where user_id = auth.uid())
    and status in ('draft','submitted')
    and exists (
      select 1 from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  )
  with check (
    manager_id in (select id from public.manager_profiles where user_id = auth.uid())
    and status in ('draft','submitted')
    and exists (
      select 1 from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  );

create policy "Managers can read their world commands"
  on public.manager_world_commands for select to authenticated
  using (manager_id in (select id from public.manager_profiles where user_id = auth.uid()));
create policy "Managers can submit appointed world commands"
  on public.manager_world_commands for insert to authenticated
  with check (
    manager_id in (select id from public.manager_profiles where user_id = auth.uid())
    and exists (
      select 1 from public.manager_appointments a
      where a.manager_id = manager_world_commands.manager_id
        and a.world_id = manager_world_commands.world_id
        and a.club_id = manager_world_commands.club_id
        and a.status = 'active'
    )
  );

create policy "Authenticated managers can read turn runs"
  on public.world_turn_runs for select to authenticated using (true);

create policy "admins read world backups" on public.persistent_world_backups
  for select using (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins create world backups" on public.persistent_world_backups
  for insert with check (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins update world backups" on public.persistent_world_backups
  for update using (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins read operation events" on public.world_operation_events
  for select using (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins create operation events" on public.world_operation_events
  for insert with check (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins read operation alerts" on public.world_operation_alerts
  for select using (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));
create policy "admins manage operation alerts" on public.world_operation_alerts
  for all using (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true))
  with check (exists (select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true));

comment on table public.canonical_world_saves is 'One authoritative save per TBG world. Managers have read access only; service-role scheduled processing owns writes.';
comment on table public.manager_turn_submissions is 'Club instructions submitted before a centrally controlled turn deadline.';
comment on table public.manager_world_commands is 'Manager registration, contract and transfer requests applied by trusted world processing.';
