begin;

create table if not exists public.team_sheet_presets (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  formation text not null,
  starting_xi jsonb not null default '[]'::jsonb,
  bench jsonb not null default '[]'::jsonb,
  captain_id text,
  set_piece_takers jsonb not null default '{}'::jsonb,
  tactics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manager_id, club_id, name)
);

create index if not exists team_sheet_presets_manager_club_idx
  on public.team_sheet_presets (manager_id, club_id, updated_at desc);

alter table public.team_sheet_presets enable row level security;

drop policy if exists team_sheet_presets_select_own on public.team_sheet_presets;
create policy team_sheet_presets_select_own on public.team_sheet_presets
for select to authenticated
using (
  manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  )
);

drop policy if exists team_sheet_presets_insert_own on public.team_sheet_presets;
create policy team_sheet_presets_insert_own on public.team_sheet_presets
for insert to authenticated
with check (
  manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  )
  and exists (
    select 1 from public.manager_appointments ma
    where ma.manager_id = team_sheet_presets.manager_id
      and ma.club_id = team_sheet_presets.club_id
      and ma.status = 'active'
  )
);

drop policy if exists team_sheet_presets_update_own on public.team_sheet_presets;
create policy team_sheet_presets_update_own on public.team_sheet_presets
for update to authenticated
using (
  manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  )
)
with check (
  manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  )
  and exists (
    select 1 from public.manager_appointments ma
    where ma.manager_id = team_sheet_presets.manager_id
      and ma.club_id = team_sheet_presets.club_id
      and ma.status = 'active'
  )
);

drop policy if exists team_sheet_presets_delete_own on public.team_sheet_presets;
create policy team_sheet_presets_delete_own on public.team_sheet_presets
for delete to authenticated
using (
  manager_id in (
    select id from public.manager_profiles where user_id = auth.uid()
  )
);

commit;