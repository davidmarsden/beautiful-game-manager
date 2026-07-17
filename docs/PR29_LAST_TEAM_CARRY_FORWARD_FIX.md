# PR #29 — Last-team carry-forward without a scheduled fixture

## Problem

PR #28 only requested the carry-forward seed when `next_fixture` existed. After the final scheduled demo fixture had been played, the Tactics & Team screen therefore fell back to its default checkbox selection instead of showing the manager's most recent submitted XI and bench.

## Fix

- `team-seed` now accepts `club_id` on its own.
- With a fixture ID, the current fixture submission still takes priority, followed by the latest previous submitted/locked team.
- Without a fixture ID, the endpoint returns the club's latest submitted/locked team.
- The Tactics & Team screen restores that team even while no fixture is scheduled and labels it `LAST TEAM`.
- When a new fixture appears, the same selection is carried forward and labelled `CARRIED FORWARD` until the manager saves it for that fixture.

## Preview checks

1. Open Tactics & Team with no next fixture.
2. Confirm the latest submitted XI, exact slot order, seven substitutes, captain, formation and tactics are restored.
3. Confirm the badge reads `LAST TEAM`.
4. Schedule a new fixture with no submission and reload.
5. Confirm the same team is shown with `CARRIED FORWARD`.
6. Save the team, reload, and confirm `CURRENT SUBMISSION` takes priority.

No database migration is required.