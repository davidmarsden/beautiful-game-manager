create table if not exists public.persistent_world_saves (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  save_version text not null,
  save_checksum text not null,
  save_envelope jsonb not null,
  season_id text,
  season_number integer,
  phase text,
  matchday integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, manager_id)
);

create index if not exists persistent_world_saves_manager_idx
  on public.persistent_world_saves(manager_id, updated_at desc);

alter table public.persistent_world_saves enable row level security;

create policy "Managers can read their persistent save"
  on public.persistent_world_saves
  for select
  using (manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  ));

create policy "Managers can insert their persistent save"
  on public.persistent_world_saves
  for insert
  with check (manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  ));

create policy "Managers can update their persistent save"
  on public.persistent_world_saves
  for update
  using (manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  ))
  with check (manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  ));
