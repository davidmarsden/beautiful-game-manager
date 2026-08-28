-- Selective foreign-key indexing pass.
--
-- These indexes cover relationships that are either already on hot Manager Portal
-- paths (notably manager_appointments) or are expected to grow materially with a
-- persistent world (fixtures, submissions, News, notifications, clubs). We
-- intentionally do not index every FK reported by the Supabase linter: many
-- transfer/admin/audit relationships are already served by world-scoped composite
-- indexes or are too low-volume to justify another write-maintained index yet.

create index if not exists manager_appointments_manager_idx
  on public.manager_appointments(manager_id);

create index if not exists manager_appointments_club_idx
  on public.manager_appointments(club_id);

create index if not exists clubs_world_idx
  on public.clubs(world_id);

create index if not exists fixtures_world_idx
  on public.fixtures(world_id);

create index if not exists fixtures_home_club_idx
  on public.fixtures(home_club_id);

create index if not exists fixtures_away_club_idx
  on public.fixtures(away_club_id);

create index if not exists manager_submissions_manager_idx
  on public.manager_submissions(manager_id);

create index if not exists manager_submissions_club_idx
  on public.manager_submissions(club_id);

create index if not exists world_feed_comments_manager_idx
  on public.world_feed_comments(manager_id);

create index if not exists world_feed_items_actor_manager_idx
  on public.world_feed_items(actor_manager_id);

create index if not exists manager_notifications_world_idx
  on public.manager_notifications(world_id);
