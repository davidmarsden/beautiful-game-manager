# PR #48 — Stateful full-season simulation harness

## Purpose

Run the constitutional engine through a complete home-and-away league season while carrying match-layer state from fixture to fixture.

## Harness

`src/matchEngine/seasonSimulation.js` provides:

- a deterministic double round-robin scheduler;
- synthetic calibration clubs with varied ratings and tactical identities;
- fixture-by-fixture team selection;
- elapsed-rest recovery using Module C's recovery dial;
- persisted Fitness, injury and suspension state;
- previous-lineup continuity;
- exactly-once state application by `run_key`;
- league-table construction and reconciliation;
- season-wide event-ID and lineup invariants.

## Acceptance checks

A completed run must prove:

- every fixture is played and applied exactly once;
- every club plays the expected number of matches;
- wins, draws, losses and points reconcile;
- aggregate goals for equal aggregate goals against;
- public event IDs remain globally unique across the season;
- player Fitness remains within 0–100;
- no starting XI contains duplicates or overlaps its bench;
- identical inputs produce identical fixtures, scores, standings and metrics.

## Calibration boundary

PR #47's adjacent-bucket validator has correctly exposed a non-monotonic live upset curve. PR #48 keeps that finding visible without pretending the engine already passes it. PR #49 remains responsible for tuning rating-band and elite-tail behaviour until the live curve passes the unchanged validator.

The default constitutional cutover remains out of scope.
