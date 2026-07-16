begin;

alter table public.fixtures
  add column if not exists home_score integer,
  add column if not exists away_score integer,
  add column if not exists played_at timestamptz,
  add column if not exists result_payload jsonb;

alter table public.match_runs
  add column if not exists result_payload jsonb;

create table if not exists public.match_events (
  event_id text primary key,
  fixture_id text not null references public.fixtures(id) on delete cascade,
  event_type text not null,
  side text not null check (side in ('home','away')),
  minute integer not null check (minute between 0 and 130),
  player_id text,
  assist_player_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists match_events_fixture_minute_idx
  on public.match_events (fixture_id, minute, event_id);

alter table public.match_events enable row level security;

drop policy if exists "authenticated managers can read match events" on public.match_events;
create policy "authenticated managers can read match events"
  on public.match_events for select to authenticated using (true);

create or replace function public.claim_fixtures_for_engine(batch_size integer default 10)
returns setof public.fixtures
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.fixtures
    where status = 'scheduled'
      and submissions_lock_status = 'locked'
      and (
        engine_run_status in ('pending','prepared','error')
        or (engine_run_status = 'processing' and engine_processing_started_at < now() - interval '15 minutes')
      )
      and kickoff_at is not null
      and kickoff_at <= now()
    order by kickoff_at, id
    for update skip locked
    limit greatest(batch_size, 1)
  )
  update public.fixtures f
  set engine_run_status = 'processing',
      engine_processing_started_at = now(),
      engine_run_error = null
  from due
  where f.id = due.id
  returning f.*;
end;
$$;

revoke all on function public.claim_fixtures_for_engine(integer) from public, anon, authenticated;
grant execute on function public.claim_fixtures_for_engine(integer) to service_role;

commit;
