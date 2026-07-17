begin;

create table if not exists public.manager_match_views (
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  fixture_id text not null references public.fixtures(id) on delete cascade,
  revealed_at timestamptz,
  reveal_method text,
  replay_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (manager_id, fixture_id),
  constraint manager_match_views_reveal_method_check
    check (reveal_method is null or reveal_method in ('replay_completed', 'skip_to_full_time'))
);

create index if not exists manager_match_views_fixture_idx
  on public.manager_match_views (fixture_id, manager_id);

alter table public.manager_match_views enable row level security;

drop policy if exists "managers can read their own match views" on public.manager_match_views;
create policy "managers can read their own match views"
  on public.manager_match_views for select to authenticated
  using (manager_id in (select id from public.manager_profiles where user_id = auth.uid()));

drop policy if exists "managers can create their own match views" on public.manager_match_views;
create policy "managers can create their own match views"
  on public.manager_match_views for insert to authenticated
  with check (manager_id in (select id from public.manager_profiles where user_id = auth.uid()));

drop policy if exists "managers can update their own match views" on public.manager_match_views;
create policy "managers can update their own match views"
  on public.manager_match_views for update to authenticated
  using (manager_id in (select id from public.manager_profiles where user_id = auth.uid()))
  with check (manager_id in (select id from public.manager_profiles where user_id = auth.uid()));

commit;
