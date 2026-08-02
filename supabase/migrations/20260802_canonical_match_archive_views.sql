create table if not exists public.manager_canonical_match_views (
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  fixture_id text not null references public.canonical_match_archives(fixture_id) on delete cascade,
  revealed_at timestamptz not null default now(),
  reveal_method text not null check (reveal_method in ('replay_completed', 'skip_to_full_time')),
  replay_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (manager_id, fixture_id)
);

alter table public.manager_canonical_match_views enable row level security;
revoke all on public.manager_canonical_match_views from public, anon, authenticated;

insert into public.manager_canonical_match_views (
  manager_id, fixture_id, revealed_at, reveal_method, replay_completed, created_at, updated_at
)
select
  legacy.manager_id,
  legacy.fixture_id,
  legacy.revealed_at,
  legacy.reveal_method,
  legacy.replay_completed,
  legacy.created_at,
  legacy.updated_at
from public.manager_match_views legacy
join public.canonical_match_archives archive on archive.fixture_id = legacy.fixture_id
where legacy.revealed_at is not null
  and legacy.reveal_method is not null
on conflict (manager_id, fixture_id) do nothing;
