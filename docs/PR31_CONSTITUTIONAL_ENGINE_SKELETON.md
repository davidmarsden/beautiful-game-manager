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
