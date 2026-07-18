# Roadmap PR #42 — Match-state persistence and recovery

## Purpose

Module C already projects post-match fitness and Module E publishes resolved injury and disciplinary changes. This change makes those outputs durable and feeds them back into the next fixture.

## Storage

Two service-role-only tables are added:

- `player_match_state` stores the latest per-world player Fitness, Sharpness, Morale, injury, discipline, suspension and last-played state;
- `match_state_applications` is an immutable run ledger that makes state application idempotent.

The `apply_match_state_changes` RPC inserts the run ledger and updates all player rows in one database transaction. Replaying the same `run_key` returns `false` and does not apply any change twice.

## Recovery

Before a fixture, the runner loads persisted state for every starter and substitute. Fitness recovers at the constitutional Module C rate of nine points per elapsed rest day, capped at 100. The recovered state is attached to the engine contract so built-in and remote runners receive identical inputs.

A new season resets match-layer fatigue, injuries, suspensions and card accumulation. This is deliberately a match-layer rollover rule; long-term player Ability and Form remain outside this store.

## Fixture-runner flow

1. Build the locked engine contract.
2. Load persisted state for both squads.
3. Recover Fitness to kickoff time.
4. Execute the selected engine mode.
5. Persist official Module E state changes through the idempotent RPC.
6. Finalise the fixture and competition state.

`TBG_MATCH_ENGINE_MODE=constitutional-v1` enables state-changing constitutional results. Compatibility mode remains the default during staged calibration and therefore produces no Module E public `state_changes` to persist.

## Guarantees

- retries cannot double-apply Fitness loss, injuries or cards;
- two consecutive constitutional fixtures use different starting Fitness when recovery is incomplete;
- recovery never exceeds 100;
- injury persistence occurs only from resolved Module E injury events;
- straight reds and second-yellow dismissals are persisted from reconciled disciplinary state;
- season rollover clears match-layer carry-over;
- no public Match Centre contract change.

## Deferred

Suspension duration and injury recovery/clearance policies need competition and medical rules beyond this persistence foundation. This PR records the outcomes safely; later governance work will decide when those statuses clear.
