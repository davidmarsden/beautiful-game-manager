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

## Important testing note

Previously completed fixtures retain their original saved event stream. This is intentional: historical match records must not silently change after a simulator upgrade.

To test PR #26, use a newly processed fixture after deploying the preview. Lock both submissions, set kickoff in the past and let `run-fixtures` complete it.

## Preview verification

1. Process a new fixture with the built-in simulator.
2. Confirm `match_runs.result_payload->>'result_version'` is `2d5-v1`.
3. Confirm the fixture has substantially more than goal events:

```sql
select event_type, count(*)
from public.match_events
where fixture_id = '<NEW FIXTURE ID>'
group by event_type
order by event_type;
```

4. Open the spoiler-safe replay.
5. Confirm quiet passages, attacks, shots, saves, tackles, fouls, offsides, cards and crowd reactions appear at their saved minutes.
6. Confirm the score changes only on goal events.
7. Confirm half-time appears at 45' and full-time at 90'.
8. Reveal the result and confirm the report contains the same chronological commentary.

## Contract

The result contract advances to `2d5-v1`. The full constitutional engine can later replace this generator while preserving the same event and Match Centre interfaces.
