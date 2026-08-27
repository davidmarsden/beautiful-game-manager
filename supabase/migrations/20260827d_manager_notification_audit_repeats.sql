begin;

-- Audit events represent transitions, not just first-seen states. Re-entering the
-- same lifecycle state later (for example triaged -> new -> triaged) therefore
-- needs a fresh event identity and a fresh manager notification.
create or replace function public.record_alpha_feedback_event(
  p_report public.alpha_feedback_reports,
  p_event_type text,
  p_title text,
  p_body text,
  p_class text default 'info',
  p_action_url text default null,
  p_created_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_key text;
begin
  v_key := 'alpha_feedback:' || p_report.id::text || ':' || p_event_type || ':' || v_event_id::text;

  insert into public.alpha_feedback_events(
    id, report_id, world_id, manager_id, event_type, status, severity,
    github_issue_url, dedupe_key, created_at
  ) values (
    v_event_id, p_report.id, p_report.world_id, p_report.manager_id,
    p_event_type, p_report.status, p_report.severity, p_report.github_issue_url,
    v_key, p_created_at
  );

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class, title, body,
    action_url, source_type, source_id, dedupe_key, created_at
  ) values (
    p_report.world_id, p_report.manager_id, 'alpha_feedback', p_class, p_title, p_body,
    coalesce(p_action_url, p_report.github_issue_url), 'alpha_feedback_report',
    p_report.id::text, v_key, p_created_at
  );
end;
$$;

revoke all on function public.record_alpha_feedback_event(public.alpha_feedback_reports,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_alpha_feedback_event(public.alpha_feedback_reports,text,text,text,text,text,timestamptz) to service_role;

commit;
