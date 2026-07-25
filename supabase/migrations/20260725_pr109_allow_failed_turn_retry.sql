-- PR #109: preserve failed turn attempts while permitting one controlled retry.
--
-- The original PR #81 table-level uniqueness constraint covered failed rows as
-- well as active/completed runs. A repaired checkpoint therefore could not
-- insert its replacement processing row for the same canonical turn. Failed
-- attempts remain immutable audit history, while at most one non-failed run
-- may exist for a world/season/matchday.

alter table public.world_turn_runs
  drop constraint if exists world_turn_runs_world_id_season_id_matchday_key;

create unique index if not exists world_turn_runs_one_nonfailed_attempt_per_turn
  on public.world_turn_runs (world_id, season_id, matchday)
  where status <> 'failed';
