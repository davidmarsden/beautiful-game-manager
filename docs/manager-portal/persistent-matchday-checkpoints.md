# Persistent matchday checkpoints

PR #76 replaces the persistent world's whole-season transaction boundary with one saved transaction per league matchday.

## Advancement contract

A persistent league world can now be advanced by exactly one matchday. Each call:

1. loads and validates the current save;
2. starts the season only when the world is in preseason;
3. processes the current matchday in all five divisions;
4. records the human manager's submitted instruction for their fixture;
5. updates player fitness, availability, standings and match events;
6. records a unique matchday checkpoint;
7. saves and reloads the world before returning it.

The world retains a JSON-safe `matchday_cycle` while the season is active. It contains the fixture cursor, partial standings, results, availability state, human decisions and checkpoint history for every division.

## Replay protection

Every simulated fixture stores its deterministic run key. A fixture whose run key is already present cannot be applied again, even if a damaged cursor is moved backwards.

## Season completion

Only the final matchday triggers:

- five reconciled division archives;
- promotion and relegation across all four boundaries;
- persistent movement history;
- youth intake and contract expiry;
- next-season calendar rollover;
- AI squad repair;
- return to preseason.

No archive or movement is created before every scheduled fixture has completed.

## Acceptance boundary

The CI report uses five divisions of four clubs, producing six matchdays and sixty fixtures. It proves:

- one checkpoint per matchday;
- every fixture applied exactly once;
- save/load validity after every checkpoint;
- a save resumed after Matchday 3 reaches the identical final world as an uninterrupted run;
- five accepted archives and eight persisted movements at season end;
- a clean return to preseason for Season 2.

This establishes matchday-level transactional persistence. It does not yet expose advancement controls through the manager portal or schedule individual fixtures at different real-world times within the same matchday.
