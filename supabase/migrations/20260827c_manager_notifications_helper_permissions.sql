begin;

-- Trigger/helper functions are internal implementation details. In particular,
-- record_alpha_feedback_event is SECURITY DEFINER and must never be callable
-- directly by a browser role with a forged composite report value.
revoke all on function public.alpha_feedback_points(text) from public, anon, authenticated;
revoke all on function public.record_alpha_feedback_event(public.alpha_feedback_reports,text,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.emit_alpha_feedback_lifecycle() from public, anon, authenticated;

grant execute on function public.alpha_feedback_points(text) to service_role;
grant execute on function public.record_alpha_feedback_event(public.alpha_feedback_reports,text,text,text,text,text,timestamptz) to service_role;
-- Trigger execution does not require browser-role EXECUTE permission; granting
-- to service_role keeps administrative/database tooling explicit.
grant execute on function public.emit_alpha_feedback_lifecycle() to service_role;

commit;
