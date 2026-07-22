# Representative persistent-world release candidate

PR #80 proves the integrated persistent-world architecture at a scale substantially beyond the earlier four-club harnesses.

## Scale profile

The CI release candidate runs:

- five divisions;
- eight clubs per division;
- forty clubs in total;
- realistic nineteen-player opening squads;
- three complete seasons;
- fourteen matchdays per season;
- twenty fixtures per matchday;
- 840 league fixtures in the primary trajectory.

This is a representative operating profile rather than the final 100-club production universe. It is large enough to exercise multi-division persistence, save growth, event identity, AI squad management and repeated promotion and relegation without making every pull request run a full 100-club multi-season simulation.

## Integrated systems

The scenario exercises the systems as one world rather than as isolated reports:

1. a five-division persistent world is created;
2. the portal renews a human-club contract and completes an agreed transfer;
3. matchdays advance through durable checkpoints;
4. a Transfermarkt lifecycle manifest retires one player and inactivates two others between matchdays;
5. seasons archive and roll over with promotion and relegation;
6. AI clubs repair squads at each offseason;
7. a midpoint canonical backup is created;
8. the final save is inspected through the operational monitoring contract;
9. the midpoint backup is restored and replayed to the same final world;
10. the final save is loaded through the portal contract.

## Determinism and recovery evidence

The release candidate compares four paths:

- the primary uninterrupted trajectory;
- a second identical uninterrupted trajectory;
- a save resumed from the midpoint;
- a world restored from the midpoint operational backup and replayed.

All four must produce the same final canonical save checksum.

## Acceptance gates

The RC rejects unless:

- all matchdays are accepted;
- the scheduled fixture count reconciles;
- uninterrupted, resumed and restored-replay saves are identical;
- every archive, movement, checkpoint, player and event ID is unique;
- every owned player has an active contract;
- registrations reference valid players;
- lifecycle, matchday and squad-cycle validation all pass;
- portal contract and transfer actions survive into the final ledger;
- the world advances exactly three seasons and returns to preseason;
- operational backup, restore and monitoring contracts accept the world.

## Reality-led player lifecycle

This release candidate does not introduce synthetic ageing, development or retirement. Player eligibility remains controlled by the approved real-world registry and lifecycle reconciliation pipeline. Synthetic youth intake remains a harness mechanism until the production world consumes the approved youth-discovery feed.

## Remaining scale boundary

The final production profile is still expected to contain five divisions of twenty clubs. A 100-club soak should be run as a scheduled or manually triggered release exercise rather than on every ordinary pull request. PR #80 establishes a blocking representative-scale gate suitable for continuous integration.
