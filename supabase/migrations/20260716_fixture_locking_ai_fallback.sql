begin;

alter table public.manager_submissions
  add column if not exists submission_source text not null default 'manager'
    check (submission_source in ('manager','ai_fallback')),
  add column if not exists lock_reason text;

alter table public.fixtures
  add column if not exists submissions_locked_at timestamptz,
  add column if not exists submissions_lock_status text not null default 'open'
    check (submissions_lock_status in ('open','processing','locked','error')),
  add column if not exists submissions_lock_error text;

create index if not exists fixtures_due_for_submission_lock_idx
  on public.fixtures (submission_deadline_at)
  where status = 'scheduled' and submissions_lock_status = 'open';

create index if not exists manager_submissions_fixture_club_status_idx
  on public.manager_submissions (fixture_id, club_id, status);

create or replace function public.claim_expired_fixtures_for_submission_lock(batch_size integer default 20)
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
      and submissions_lock_status = 'open'
      and submission_deadline_at is not null
      and submission_deadline_at <= now()
    order by submission_deadline_at, id
    for update skip locked
    limit greatest(batch_size, 1)
  )
  update public.fixtures f
  set submissions_lock_status = 'processing',
      submissions_lock_error = null
  from due
  where f.id = due.id
  returning f.*;
end;
$$;

create or replace function public.complete_fixture_submission_lock(
  fixture_key text,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fixtures
  set submissions_lock_status = case when failure_message is null then 'locked' else 'error' end,
      submissions_locked_at = case when failure_message is null then coalesce(submissions_locked_at, now()) else submissions_locked_at end,
      submissions_lock_error = failure_message
  where id = fixture_key;
end;
$$;

revoke all on function public.claim_expired_fixtures_for_submission_lock(integer) from public, anon, authenticated;
revoke all on function public.complete_fixture_submission_lock(text, text) from public, anon, authenticated;
grant execute on function public.claim_expired_fixtures_for_submission_lock(integer) to service_role;
grant execute on function public.complete_fixture_submission_lock(text, text) to service_role;

commit;
