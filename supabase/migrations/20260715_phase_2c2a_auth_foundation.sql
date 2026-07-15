begin;

create extension if not exists pgcrypto;

create table if not exists public.worlds (
  id text primary key,
  name text not null,
  active_season_id text,
  status text not null default 'setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clubs (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  name text not null,
  short_name text,
  division_id text,
  world_rank integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_appointments (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  club_id text not null references public.clubs(id) on delete cascade,
  control_type text not null default 'human' check (control_type in ('human','ai','caretaker','vacant')),
  status text not null default 'active' check (status in ('active','ended','pending')),
  appointed_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_manager_per_club
  on public.manager_appointments(world_id, club_id)
  where status = 'active';

create unique index if not exists one_active_club_per_manager
  on public.manager_appointments(world_id, manager_id)
  where status = 'active';

create table if not exists public.fixtures (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  season_id text not null,
  competition_id text,
  home_club_id text not null references public.clubs(id),
  away_club_id text not null references public.clubs(id),
  matchday integer,
  kickoff_at timestamptz,
  submission_deadline_at timestamptz,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.manager_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text references public.clubs(id) on delete cascade,
  message_type text not null default 'general',
  subject text not null,
  body text not null,
  related_fixture_id text references public.fixtures(id) on delete set null,
  related_player_id text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.worlds enable row level security;
alter table public.clubs enable row level security;
alter table public.manager_profiles enable row level security;
alter table public.manager_appointments enable row level security;
alter table public.fixtures enable row level security;
alter table public.manager_messages enable row level security;

create or replace function public.current_manager_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.manager_profiles where user_id = auth.uid() limit 1
$$;

revoke all on function public.current_manager_id() from public;
grant execute on function public.current_manager_id() to authenticated;

create policy "authenticated users can read worlds"
  on public.worlds for select to authenticated using (true);

create policy "authenticated users can read clubs"
  on public.clubs for select to authenticated using (true);

create policy "managers can read own profile"
  on public.manager_profiles for select to authenticated
  using (user_id = auth.uid());

create policy "managers can update own profile"
  on public.manager_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "managers can read own appointments"
  on public.manager_appointments for select to authenticated
  using (manager_id = public.current_manager_id());

create policy "managers can read own club fixtures"
  on public.fixtures for select to authenticated
  using (
    exists (
      select 1 from public.manager_appointments appointment
      where appointment.manager_id = public.current_manager_id()
        and appointment.status = 'active'
        and appointment.world_id = fixtures.world_id
        and appointment.club_id in (fixtures.home_club_id, fixtures.away_club_id)
    )
  );

create policy "managers can read own messages"
  on public.manager_messages for select to authenticated
  using (recipient_manager_id = public.current_manager_id());

create policy "managers can mark own messages read"
  on public.manager_messages for update to authenticated
  using (recipient_manager_id = public.current_manager_id())
  with check (recipient_manager_id = public.current_manager_id());

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.manager_profiles (user_id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'Manager'), '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

insert into public.worlds (id, name, active_season_id, status)
values ('tbg-world-1', 'TBG World 1', 'season-1', 'inaugural_divisions_seeded')
on conflict (id) do update set
  name = excluded.name,
  active_season_id = excluded.active_season_id,
  status = excluded.status,
  updated_at = now();

commit;
