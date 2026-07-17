# PR #30 — Previous match team loader and authoritative restoration

## Problem

The carry-forward API returned the correct latest submission and the UI showed `LAST TEAM`, but later formation-board rendering could overwrite the restored checkboxes and slot order. The result was a default XI with no bench despite the success message.

## Fix

- The restored sheet remains authoritative during initial rendering.
- A MutationObserver reapplies the exact XI and bench order if another startup script overwrites it.
- The guard is released as soon as the manager makes a real selection change, so normal editing is unaffected.
- The team-seed endpoint now returns the ten most recent submitted or locked match selections.
- A new `Load team from previous match…` selector lets managers explicitly restore any recent XI, bench, captain, formation and tactics.

## Preview test

1. Open Tactics & Team with no scheduled fixture.
2. Confirm the `LAST TEAM` badge appears.
3. Confirm the pitch and seven substitutes match the most recent submission rather than the default auto-pick.
4. Reload and confirm the same exact slot order is restored.
5. Choose an older fixture under `Load team from previous match…`.
6. Select `Load previous match`.
7. Confirm XI, bench, captain, formation and tactics all change together.
8. Tap or drag a player and confirm the manager can edit normally after restoration.

No database migration is required.