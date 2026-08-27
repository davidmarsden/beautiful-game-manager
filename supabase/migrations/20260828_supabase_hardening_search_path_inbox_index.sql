begin;

-- `alpha_feedback_points` is a pure CASE expression and does not need any
-- application schema objects. Pinning its search path removes the mutable-path
-- security advisory without changing its behaviour or execution grants.
alter function public.alpha_feedback_points(text)
  set search_path = pg_catalog;

-- The functional inbox reads the newest messages for one manager:
--   WHERE recipient_manager_id = ? ORDER BY created_at DESC LIMIT 100
-- This composite index covers that access path and the recipient FK lookup.
create index if not exists manager_messages_recipient_created_idx
  on public.manager_messages (recipient_manager_id, created_at desc);

commit;
