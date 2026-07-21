# Reality-sync player lifecycle bridge

The persistent world does not invent retirements from age. Real-world publication data decides whether a real player remains in active professional circulation.

## Input contract

Approved Transfermarkt publication refreshes emit a versioned `tbg-player-lifecycle-manifest-v1.0` containing:

- a unique source snapshot ID;
- an effective timestamp;
- stable `tbg_player_id` values;
- an upstream reality status;
- optional evidence references.

A source snapshot can be applied only once. Reapplying it is an accepted no-op.

## Lifecycle states

Persistent players remain permanently addressable and carry one of three world statuses:

- `active` — eligible for ownership, registration, selection and signing;
- `inactive` — retained with history and, where applicable, ownership and contract, but removed from registration and active circulation;
- `retired` — removed from ownership, registration and active circulation with any active contract terminated for real-world retirement.

No player record is deleted. Archived line-ups, statistics, awards and career records continue to resolve through the stable player ID.

## Upstream mapping

`RETIRED` produces a force-majeure retirement transaction:

- unregister the player;
- remove club ownership;
- terminate the active contract as `terminated_reality_retirement`;
- preserve the player and all history;
- emit `player_retired_from_reality`.

`WITHOUT_CLUB_TOO_LONG`, `UNDER_REVIEW`, `INVALID_TRANSFERMARKT_RECORD`, `DUPLICATE` and `STAFF_NOT_PLAYER` produce an inactive state:

- remove registration and selection eligibility;
- preserve ownership and an existing active contract;
- emit `player_inactivated_from_reality`.

`ACTIVE` reactivates the player. An inactive owned player keeps the existing contract but is not silently re-registered. A player returning after confirmed retirement becomes an active free agent; the previously terminated contract is never recreated. This supports the occasional real footballer who retires and later changes their mind.

## Safe checkpoints

Reality sync is accepted:

- in preseason;
- in offseason;
- between completed matchdays when every division cursor agrees with the persistent world cursor.

It is rejected while world state is incoherent or a matchday transaction cannot be shown to be complete.

## Audit and validation

Every change produces an immutable reconciliation row and world event linked to the source snapshot. Validation requires:

- unique snapshot and reconciliation IDs;
- no retired player owned, registered or actively contracted;
- no inactive player registered or selectable;
- consistent active-circulation flags;
- unchanged historical player records;
- a valid persistent matchday world after save and reload.

The bridge consumes approved lifecycle manifests. Generating those manifests from the wider Transfermarkt publication pipeline remains the responsibility of the data repository and publication workflow.
