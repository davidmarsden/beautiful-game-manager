# Phase 2D.4b — Spoiler-safe replay and result reveal

## What this phase adds

- per-manager, per-fixture reveal state;
- hidden scores and W/D/L on the dashboard until reveal;
- hidden scores in Recent Results;
- spoiler-safe inbox copy (`Your match is ready`);
- an unrevealed Match Centre that opens at 0-0 and 0';
- Report and Line-ups withheld until the replay completes or the manager skips;
- persistent reveal state after a completed replay or explicit skip;
- normal match report access after reveal.

## Deployment

1. Run `supabase/migrations/20260717_phase_2d4b_spoiler_safe_replay.sql`.
2. Deploy the PR preview.
3. Sign in as the Real Madrid manager.

Existing played fixtures start unrevealed for each manager, which makes the current Real Madrid v FC Barcelona demo suitable for the test.

## Preview verification

1. Confirm the dashboard says **MATCH READY**, not `1-2`.
2. Confirm the inbox says **Your match is ready**, without the score.
3. Confirm Recent Results hides both score and W/D/L.
4. Open the match.
5. Confirm the landing screen shows `0-0`, `00'`, and no Report or Line-ups tabs.
6. Start, pause and resume the replay.
7. Let it reach 90', or choose **SKIP TO FULL TIME**.
8. Confirm the official score and full Report/Line-ups appear.
9. Close the Match Centre. The portal reloads and now shows the result normally.
10. Reload again and confirm the reveal remains permanent for this manager.

## Database verification

```sql
select manager_id, fixture_id, revealed_at, reveal_method, replay_completed
from public.manager_match_views
where fixture_id = 'season-1-md1-demo';
```

Expected after watching the full replay:

```text
revealed_at      populated
reveal_method    replay_completed
replay_completed true
```

Expected after choosing the skip option:

```text
revealed_at      populated
reveal_method    skip_to_full_time
replay_completed false
```
