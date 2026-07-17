# Phase 2D.5 — Rich deterministic commentary and event stream

## What this phase adds

The bootstrap simulator now records a proper text-first match event stream rather than goals alone.

Events include:

- goals;
- saved, missed and blocked shots;
- dangerous attacks;
- corners;
- fouls;
- tackles;
- offsides;
- yellow cards;
- crowd and quiet-spell observations;
- half-time and full-time.

Every event is deterministic for the fixture run key and carries engine-authored commentary in its payload. The Match Centre displays that saved commentary during replay and in the permanent report. It does not invent new action in the browser.

## Deployment

Run this migration before processing a new fixture:

```text
supabase/migrations/20260717_phase_2d5_neutral_match_events.sql
```

It extends `match_events.side` to allow `neutral` for half-time, full-time and other match-wide events.

## Important testing note

Previously completed fixtures retain their original saved event stream. This is intentional: historical match records must not silently change after a simulator upgrade.

To test PR #26, use a newly processed fixture after deploying the preview. Lock both submissions, set kickoff in the past and let `run-fixtures` complete it.

## Preview verification

1. Run the Phase 2D.5 migration.
2. Process a new fixture with the built-in simulator.
3. Confirm `match_runs.result_payload->>'result_version'` is `2d5-v1`.
4. Confirm the fixture has substantially more than goal events:

```sql
select event_type, side, count(*)
from public.match_events
where fixture_id = '<NEW FIXTURE ID>'
group by event_type, side
order by event_type, side;
```

5. Confirm `half_time` and `full_time` are stored with `side = 'neutral'`.
6. Open the spoiler-safe replay.
7. Confirm quiet passages, attacks, shots, saves, tackles, fouls, offsides, cards and crowd reactions appear at their saved minutes.
8. Confirm the score changes only on goal events.
9. Confirm half-time appears at 45' and full-time at 90'.
10. Reveal the result and confirm the report contains the same chronological commentary.

## Contract

The result contract advances to `2d5-v1`. The full constitutional engine can later replace this generator while preserving the same event and Match Centre interfaces.
