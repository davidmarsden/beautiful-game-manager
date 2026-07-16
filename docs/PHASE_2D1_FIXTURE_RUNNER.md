# Phase 2D.1 — Fixture runner, submission loader and engine bridge

## What this phase does

The scheduled `run-fixtures` worker claims fixtures that:

- are scheduled;
- have both submissions locked;
- have reached kickoff;
- have not already completed an engine run.

It loads both locked submissions, validates the XI and bench shape, builds the versioned `2d1-v1` engine contract and stores it in `match_runs`.

If `TBG_ENGINE_RUNNER_URL` is configured, the worker POSTs that contract to the engine. Without an engine URL, it stops safely at `prepared`, allowing the contract to be inspected before Phase 2D.2 simulation is connected.

## Deployment

1. Run `supabase/migrations/20260716_phase_2d1_fixture_runner.sql` in Supabase.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` configured in Netlify.
3. Optional for a remote engine endpoint:
   - `TBG_ENGINE_RUNNER_URL`
   - `TBG_ENGINE_RUNNER_TOKEN`
4. Deploy. Netlify runs `run-fixtures` every five minutes.

## Engine contract

The contract contains:

- fixture/world/season/competition identity;
- home and away club IDs;
- ordered starting XI and bench;
- captain and set-piece assignments;
- formation and tactics;
- manager or AI submission provenance;
- a stable `run_key` and contract version.

## Browser-only verification

Use a fixture whose submissions are locked and set `kickoff_at` to the past. Wait for the scheduled worker, then run:

```sql
select id, engine_run_status, engine_run_error
from public.fixtures
where id = 'season-1-md1-demo';
```

With no remote engine configured, expect `engine_run_status = prepared`.

Then inspect the payload:

```sql
select fixture_id, status, engine_contract_version,
       request_payload->'teams'->'home'->'starting_xi' as home_xi,
       request_payload->'teams'->'away'->'starting_xi' as away_xi,
       request_payload
from public.match_runs
where fixture_id = 'season-1-md1-demo';
```

Expect one row, status `prepared`, contract version `2d1-v1`, and 11 players for each side.
