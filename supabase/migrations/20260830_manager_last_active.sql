begin;

create table if not exists public.manager_world_activity (
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  last_active_at timestamptz not null default now(),
  primary key (manager_id, world_id)
);

create index if not exists manager_world_activity_world_last_active_idx
  on public.manager_world_activity(world_id, last_active_at desc);

alter table public.manager_world_activity enable row level security;

commit;
