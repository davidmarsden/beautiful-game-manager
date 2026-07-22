-- PR #81: TBG is one shared, centrally advanced world.
-- Do not deploy the PR #78 per-manager-save migration. This migration removes that model if present.

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

-- PR #79 backups and alerts now belong to the world, not to an individual manager save.
alter table if exists public.persistent_world_backups alter column manager_id drop not null;
alter table if exists public.persistent_world_backups alter column club_id drop not null;
drop index if exists public.persistent_world_backups_lookup_idx;
create index if not exists persistent_world_backups_world_idx on public.persistent_world_backups(world_id, created_at desc);

create index if not exists manager_turn_submissions_manager_idx on public.manager_turn_submissions(manager_id, submitted_at desc);
create index if not exists manager_world_commands_manager_idx on public.manager_world_commands(manager_id, submitted_at desc);
create index if not exists canonical_world_due_idx on public.canonical_world_saves(turn_status, next_turn_at);

alter table public.canonical_world_saves enable row level security;
alter table public.manager_turn_submissions enable row level security;
alter table public.manager_world_commands enable row level security;
alter table public.world_turn_runs enable row level security;

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

comment on table public.canonical_world_saves is 'One authoritative save per TBG world. Managers have read access only; service-role scheduled processing owns writes.';
comment on table public.manager_turn_submissions is 'Club instructions submitted before a centrally controlled turn deadline.';
comment on table public.manager_world_commands is 'Manager registration, contract and transfer requests applied by trusted world processing.';
