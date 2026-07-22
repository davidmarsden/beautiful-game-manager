create extension if not exists pgcrypto;

create table if not exists public.persistent_world_backups (
  id uuid primary key default gen_random_uuid(),
  backup_id text not null unique,
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
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

create index if not exists persistent_world_backups_lookup_idx
  on public.persistent_world_backups(world_id, manager_id, created_at desc);

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

create index if not exists world_operation_events_lookup_idx
  on public.world_operation_events(world_id, created_at desc);

create table if not exists public.world_operation_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_id text not null unique,
  world_id text not null,
  manager_id uuid references public.manager_profiles(id) on delete cascade,
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

create index if not exists world_operation_alerts_open_idx
  on public.world_operation_alerts(world_id, status, created_at desc);

alter table public.persistent_world_backups enable row level security;
alter table public.world_operation_events enable row level security;
alter table public.world_operation_alerts enable row level security;

create policy "admins read world backups" on public.persistent_world_backups
  for select using (exists (
    select 1 from public.manager_profiles p where p.id = manager_id and p.user_id = auth.uid() and p.is_admin = true
  ));
create policy "admins create world backups" on public.persistent_world_backups
  for insert with check (exists (
    select 1 from public.manager_profiles p where p.id = created_by and p.user_id = auth.uid() and p.is_admin = true
  ));
create policy "admins update world backups" on public.persistent_world_backups
  for update using (exists (
    select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true
  ));

create policy "admins read operation events" on public.world_operation_events
  for select using (exists (
    select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true
  ));
create policy "admins create operation events" on public.world_operation_events
  for insert with check (exists (
    select 1 from public.manager_profiles p where p.id = requested_by and p.user_id = auth.uid() and p.is_admin = true
  ));

create policy "admins read operation alerts" on public.world_operation_alerts
  for select using (exists (
    select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true
  ));
create policy "admins manage operation alerts" on public.world_operation_alerts
  for all using (exists (
    select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true
  )) with check (exists (
    select 1 from public.manager_profiles p where p.user_id = auth.uid() and p.is_admin = true
  ));
