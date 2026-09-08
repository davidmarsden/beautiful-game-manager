begin;

create table if not exists public.manager_player_shortlists (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  player_id text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manager_id, world_id, player_id)
);

create index if not exists manager_player_shortlists_manager_world_idx
  on public.manager_player_shortlists(manager_id, world_id, created_at desc);

alter table public.manager_player_shortlists enable row level security;
revoke all on table public.manager_player_shortlists from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_player_shortlists to service_role;

comment on table public.manager_player_shortlists is
  'Private manager-owned player shortlists, scoped to one TBG world. Access is mediated by authenticated server functions; shortlist contents are never projected publicly.';

commit;
