# PR #36 — Module C: Fatigue & Context

## Purpose

This PR replaces Module C's no-op with a deterministic match-layer state resolver. It models what the selected team brings into the match and the workload it is projected to leave with, without writing to Ability, Form, Potential, Reputation or the public result contract.

## Fitness and workload

Each selected player resolves:

- current Fitness on a 0–100 scale;
- a bounded Fitness modifier with a constitutional floor of `0.60`;
- Sharpness and its small bounded modifier;
- Morale and its tight `0.90–1.10` modifier;
- transparent workload demand from role, pressing, tempo and Work Rate;
- projected 90-minute fitness cost and post-match fitness;
- fatigue-driven injury risk.

The starting dials follow Appendix C:

- MatchCost: approximately 35 fitness per 90 minutes;
- Recovery: approximately 9 fitness per rest day;
- injury risk: low baseline plus the larger fatigue-driven term.

This PR projects state updates only. Persistence and seeded injury events belong to the later match-resolution/state-write path.

## Rotation, cohesion and familiarity

Module C separates two earned states:

- **Squad Cohesion** belongs to the selected players and is reduced by lineup churn;
- **Tactical Familiarity** belongs to the club's formation-style-route package and survives rotation.

Both mainly narrow variance. Cohesion carries 80% of the narrowing weight and Familiarity 20%, preserving Appendix C's familiarity cushion without turning settledness into a large mean bonus.

Familiarity's mean modifier is deliberately restricted to `0.98–1.02`.

## Immutable output

Module C writes:

`context.state.module_c_fatigue_context`

The payload contains home and away player contexts, team averages, rotation continuity, Cohesion, Familiarity and the resulting dispersion multiplier.

It carries:

- `state_updates_projected_only: true`;
- `applied_to_public_result: false`.

## Compatibility

No score, event, commentary, persistence or Match Centre contract changes. Modules D–F remain placeholders, and the Phase 2D.5 compatibility runner remains the sole producer of the public result.

No migration required.