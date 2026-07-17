begin;

alter table public.match_events
  drop constraint if exists match_events_side_check;

alter table public.match_events
  add constraint match_events_side_check
  check (side in ('home', 'away', 'neutral'));

commit;
