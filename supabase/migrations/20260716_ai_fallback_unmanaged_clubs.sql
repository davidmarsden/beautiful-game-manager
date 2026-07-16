begin;

alter table public.manager_submissions
  alter column manager_id drop not null;

alter table public.manager_submissions
  drop constraint if exists manager_submissions_ai_manager_check;

alter table public.manager_submissions
  add constraint manager_submissions_ai_manager_check
  check (
    (submission_source = 'manager' and manager_id is not null)
    or submission_source = 'ai_fallback'
  );

commit;
