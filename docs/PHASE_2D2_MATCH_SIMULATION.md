# Phase 2D.2 — Match simulation and result persistence

## What this phase does

The existing `run-fixtures` worker now takes every prepared fixture through to a completed result.

- fixture and world snapshot IDs are normalised to the canonical fixture world/season IDs;
- the original source-world IDs remain available as audit metadata;
- when no remote engine endpoint is configured, a deterministic built-in simulator executes the match;
- when `TBG_ENGINE_RUNNER_URL` is configured, its completed result contract is persisted instead;
- scores, events, statistics and the full result contract are stored;
- the fixture becomes `played` and the engine run becomes `completed`;
- appointed managers receive a full-time inbox message.

The built-in simulator is the Phase 2D.2 persistence-capable bootstrap engine. It is deterministic by `run_key`, uses XI ratings, home advantage and submitted tactical posture, and can later be replaced by the full constitutional match engine without changing the result persistence contract.

## Deployment

1. Run `supabase/migrations/20260716_phase_2d2_match_results.sql` in Supabase.
2. Deploy the PR. Existing fixtures left at `engine_run_status = prepared` are eligible for completion after the migration.
3. Keep `SUPABASE_SERVICE_ROLE_KEY` configured in Netlify.

## Test the existing demo fixture

After deployment, wait up to five minutes, then run:

```sql
select id, status, home_score, away_score, played_at,
       engine_run_status, engine_run_error
from public.fixtures
where id = 'season-1-md1-demo';
```

Expected:

- `status = played`
- both scores populated
- `engine_run_status = completed`
- `engine_run_error is null`

Inspect the run:

```sql
select fixture_id, status, engine_contract_version,
       result_payload->'score' as score,
       result_payload->'statistics' as statistics,
       result_payload->'model' as model
from public.match_runs
where fixture_id = 'season-1-md1-demo';
```

Inspect events:

```sql
select minute, side, event_type, player_id, assist_player_id
from public.match_events
where fixture_id = 'season-1-md1-demo'
order by minute, event_id;
```
