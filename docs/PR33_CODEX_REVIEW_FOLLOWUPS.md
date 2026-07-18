# PR #33 — Historical Codex review follow-ups

This PR processes the unresolved review findings left on merged PRs #18, #21, #25 and #28.

## Confirmed and fixed

- Hidden match scores are removed from unrevealed bootstrap fixture objects rather than merely nulled in derived UI fields.
- All unrevealed `match_result` inbox messages are sanitised, including fixtures older than the ten-row dashboard history window.
- `SKIP TO FULL TIME` now persists `skip_to_full_time` rather than being pre-empted by the ordinary replay-completed path.
- Match-run attempts are recorded before the built-in or remote engine is invoked, so failed remote responses remain auditable.
- Saved and updated presets synchronise hidden selectors from the visible formation board before capture.
- Explicit preset and previous-match loads release the startup submission-restoration observer before changing the board.

## Already superseded on main

- The PR #18 reload-order finding had already been addressed by ordered selector restoration in `phase2c2b.js`.
- The PR #21 completed-fixture lifecycle finding had already been superseded by `finalise_match_and_competition_state`, which atomically marks successful fixtures played and finalises the match run.

## Compatibility

No database migration is required. Public match results, constitutional engine calculations and golden simulator fingerprints are unchanged.
