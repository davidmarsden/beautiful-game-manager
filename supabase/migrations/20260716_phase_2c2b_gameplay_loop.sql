begin;

alter table public.manager_profiles
  add column if not exists profile_completed boolean not null default false,
  add column if not exists country text,
  add column if not exists timezone text,
  add column if not exists favourite_club text;

create table if not exists public.manager_submissions (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null references public.fixtures(id) on delete cascade,
  club_id text not null references public.clubs(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  formation text not null,
  starting_xi jsonb not null,
  bench jsonb not null default '[]'::jsonb,
  captain_id text,
  set_piece_takers jsonb not null default '{}'::jsonb,
  tactics jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status text not null default 'submitted' check (status in ('draft','submitted','locked','consumed')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (fixture_id, club_id)
);

alter table public.manager_submissions enable row level security;

drop policy if exists "managers can read own submissions" on public.manager_submissions;
create policy "managers can read own submissions"
  on public.manager_submissions for select to authenticated
  using (manager_id = public.current_manager_id());

drop policy if exists "managers can create own submissions" on public.manager_submissions;
create policy "managers can create own submissions"
  on public.manager_submissions for insert to authenticated
  with check (
    manager_id = public.current_manager_id()
    and exists (
      select 1 from public.manager_appointments a
      where a.manager_id = public.current_manager_id()
        and a.club_id = manager_submissions.club_id
        and a.status = 'active'
    )
  );

drop policy if exists "managers can update own open submissions" on public.manager_submissions;
create policy "managers can update own open submissions"
  on public.manager_submissions for update to authenticated
  using (manager_id = public.current_manager_id() and status <> 'locked')
  with check (manager_id = public.current_manager_id());

create or replace function public.lock_expired_manager_submissions()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.manager_submissions s
  set status = 'locked', locked_at = coalesce(locked_at, now()), updated_at = now()
  from public.fixtures f
  where s.fixture_id = f.id
    and s.status in ('draft','submitted')
    and f.submission_deadline_at is not null
    and f.submission_deadline_at <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

insert into public.manager_messages (recipient_manager_id, club_id, message_type, subject, body, priority)
select a.manager_id, a.club_id, 'appointment', 'Welcome to The Beautiful Game',
       'Your manager account is active and your club appointment has been confirmed.', 'high'
from public.manager_appointments a
where a.status = 'active'
  and not exists (
    select 1 from public.manager_messages m
    where m.recipient_manager_id = a.manager_id and m.message_type = 'appointment'
  );

commit;
