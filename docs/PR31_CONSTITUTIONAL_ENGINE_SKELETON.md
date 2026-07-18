# PR #31 — Constitutional Match Engine Skeleton

## Milestone 31.1 — Baseline and golden regression harness

Before the bootstrap simulator is split into constitutional modules, this milestone freezes its current deterministic behaviour.

### Golden cases

Three fixed match contracts cover:

- balanced teams with balanced tactics;
- an attacking, high-pressing home side against a cautious opponent;
- a defensive home side against a positive, high-pressing away side.

Each case records the expected score, outcome, event count and SHA-256 fingerprint of the complete deterministic result contract.

### Protected output

The golden fingerprint includes:

- result and contract versions;
- run and fixture identity;
- score and outcome;
- every event ID, type, side, minute, player, assist and commentary line;
- event order;
- match statistics;
- model metadata.

`played_at` is deliberately excluded because the current simulator records the live completion time. The harness still verifies that it is a valid ISO timestamp.

### Additional contract checks

The tests also protect:

- the top-level replay/report result shape;
- goal-event counts matching the score;
- chronological event ordering;
- possession adding to 100%;
- the existing `match_events` persistence projection used by `run-fixtures`.

### Golden update rule

A changed fingerprint is a blocking failure by default. Golden fingerprints must only be updated after a deliberate, reviewed decision that the match output is intended to change.

During the remaining PR #31 refactor, every extraction into `EngineContext`, the orchestrator or Modules A–F must leave these tests green.

No production code, database schema, replay UI, reports, inbox, standings or persistence behaviour changes in milestone 31.1.

---

## Milestone 31.2 — Introduce EngineContext

The bootstrap simulator now begins each run by creating a versioned `EngineContext`.

### Context responsibilities

`EngineContext` owns the internal working references needed by future constitutional modules:

- the unchanged match contract;
- the unchanged world snapshot;
- run, fixture and team references;
- a player lookup indexed by stable TBG player ID;
- isolated per-match working state for intermediate module calculations.

The context is deliberately internal. Its version and working state are not added to the public result payload, persisted match event rows or Match Centre contract.

### Compatibility boundary

Milestone 31.2 only moves construction of the player index and contract validation behind `EngineContext`. The existing simulator still performs every strength, score, event, commentary and statistics calculation exactly as before.

The 31.1 golden fingerprints therefore remain unchanged. A green golden suite proves that introducing the context has not changed:

- scores or outcomes;
- event selection, order, minutes or commentary;
- match statistics;
- model metadata;
- replay/report or persistence contracts.

### Tests

Dedicated context tests verify:

- stable context versioning;
- unchanged input references;
- player lookup construction;
- isolated working state between match runs;
- preservation of the existing incomplete-contract validation error.

No database migration or deployment action is required.

---

## Milestone 31.3 — Module interfaces

This milestone defines the internal contracts for the six constitutional match-engine modules without yet routing simulation through them.

### Shared module interface

Every module now has a frozen, versioned descriptor containing:

- a stable module ID;
- a human-readable name;
- a unique positive execution order;
- its related constitution or appendix;
- an `execute(context)` function receiving the shared `EngineContext`.

Modules may place intermediate calculations in `context.state`, but they do not own the public result payload. That mapping remains the responsibility of the future orchestrator.

### Constitutional module sequence

1. Module A — Tactical Resolution
2. Module B — Team Quality
3. Module C — Fatigue & Context
4. Module D — Event Generation
5. Module E — Match Resolution
6. Module F — Commentary & Report

The current implementations are deliberate no-op placeholders. They return the same context and write nothing, so milestone 31.3 cannot alter scores, events, statistics, commentary or persistence.

### Validation

The module registry rejects:

- missing IDs, names or execute functions;
- invalid execution orders;
- unsupported interface versions;
- duplicate module IDs;
- duplicate execution orders.

Dedicated tests protect the six-module identity and sequence, frozen descriptors, placeholder behaviour and validation failures.

The bootstrap simulator is not yet invoked through this registry. That is milestone 31.4: the A–F orchestrator and compatibility path.

No database migration or deployment action is required.
