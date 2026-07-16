begin;

alter table public.fixtures
  add column if not exists engine_run_status text not null default 'pending'
    check (engine_run_status in ('pending','processing','prepared','submitted','completed','error')),
  add column if not exists engine_processing_started_at timestamptz,
  add column if not exists engine_submitted_at timestamptz,
  add column if not exists engine_completed_at timestamptz,
  add column if not exists engine_run_error text;

create table if not exists public.match_runs (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null unique references public.fixtures(id) on delete cascade,
  world_id text not null,
  engine_contract_version text not null default '2d1-v1',
  status text not null default 'prepared'
    check (status in ('prepared','submitted','completed','error')),
  request_payload jsonb not null,
  engine_response jsonb,
  attempt_count integer not null default 0,
  prepared_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.match_runs enable row level security;

create index if not exists fixtures_ready_for_engine_idx
  on public.fixtures (kickoff_at)
  where status = 'scheduled'
    and submissions_lock_status = 'locked'
    and engine_run_status in ('pending','error');

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
        engine_run_status in ('pending','error')
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

create or replace function public.finish_fixture_engine_run(
  fixture_key text,
  run_status text,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if run_status not in ('prepared','submitted','completed','error') then
    raise exception 'Invalid engine run status: %', run_status;
  end if;

  update public.fixtures
  set engine_run_status = run_status,
      engine_processing_started_at = null,
      engine_submitted_at = case when run_status in ('submitted','completed') then coalesce(engine_submitted_at, now()) else engine_submitted_at end,
      engine_completed_at = case when run_status = 'completed' then coalesce(engine_completed_at, now()) else engine_completed_at end,
      engine_run_error = failure_message
  where id = fixture_key;
end;
$$;

revoke all on function public.claim_fixtures_for_engine(integer) from public, anon, authenticated;
revoke all on function public.finish_fixture_engine_run(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_fixtures_for_engine(integer) to service_role;
grant execute on function public.finish_fixture_engine_run(text, text, text) to service_role;

commit;
