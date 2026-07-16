# Phase 2D.4a — Retro Match Report and Event Replay

## What this phase adds

- a clickable Last Fixture card;
- clickable rows in Recent Results;
- an authenticated match archive endpoint;
- a Ceefax/vidiprinter-inspired match report;
- final score, matchday and date;
- chronological saved events;
- possession, shots and shots on target;
- both line-ups, substitutes, formations and submission sources;
- a replay mode that reveals the stored event stream minute by minute;
- pause, speed and full-time controls.

The replay never re-simulates the match. It replays the permanent event rows already stored for the completed fixture, so the report and replay cannot disagree with the official result.

## Preview verification

1. Sign in to the manager portal.
2. Click the Last Fixture result, or the Real Madrid v FC Barcelona row under Recent Results.
3. Confirm the report opens with the official 1–2 score.
4. Confirm the event list shows goals at 4, 18 and 50 minutes.
5. Confirm the statistics match the saved result payload.
6. Open Line-ups and confirm both locked XIs and benches appear.
7. Open Replay and press START.
8. Confirm the score advances 0–1, 1–1, then 1–2 at the saved event minutes.
9. Pause, resume, change speed and use FULL TIME.
10. Close with the × button, backdrop click or Escape.

No Supabase migration is required for this phase.
