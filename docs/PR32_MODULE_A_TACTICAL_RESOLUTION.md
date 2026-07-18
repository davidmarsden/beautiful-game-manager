# PR #32 — Module A: Tactical Resolution

## Milestone 32.1 — Formation families, styles, routes and trade-offs

PR #31 established the constitutional A–F pipeline while preserving the Phase 2D.5 simulator as a compatibility runner. PR #32 begins replacing those no-op stages with real constitutional work.

Module A now resolves each submitted team plan into an internal tactical model before any quality, fatigue, event or result calculation occurs.

## Inputs

Module A reads only the football choices already present in the engine contract:

- formation;
- mentality;
- pressing;
- tempo;
- width;
- optional future-facing `style` / `tactical_style`;
- optional future-facing `route_to_goal` / `route`.

It does not read money, media, confidence or any other off-pitch state.

## Formation families

The seven currently supported formations are mapped onto Appendix A's structural axes:

- defensive base: back four, back three or back five;
- midfield base: single pivot, double pivot or flat midfield;
- attacking apex: lone striker, two striker or wide forward.

Each formation also receives transparent defence/midfield/attack shape weights, a natural route to goal, one gain and one exposure.

## Tactical styles

The constitutional starting styles are represented as internal profiles:

- possession;
- counter / transition;
- direct;
- high press;
- low block.

A neutral `balanced` compatibility profile is retained while the manager UI does not yet expose a separate style control. It deliberately carries no numerical advantage and cannot exploit a committed stylistic matchup.

When an explicit style is absent, Module A performs bounded compatibility inference from the current mentality, pressing and tempo fields. The source of every choice is recorded as manager instruction, compatibility inference or compatibility default.

## Routes to goal

Module A resolves exactly the three Appendix A routes:

- central;
- balanced;
- wide.

Existing width instructions provide a compatibility mapping: narrow becomes Central, wide becomes Wide, and absent or balanced width becomes Balanced. Balanced is implemented as robust-not-optimal: higher robustness, lower matchup upside.

Formation-route fit is also recorded. A natural committed route receives a modest positive fit; a conflicting route receives a modest penalty. These are internal dials only at this milestone.

## Trade-Off Law

Every formation, style and route profile records both:

- a footballing gain;
- a corresponding exposure.

Tests iterate the full supported formation × style × route space and fail if either half is missing.

## Engine state

Module A writes one immutable object to:

`context.state.module_a_tactical_resolution`

It contains independent home and away resolutions. No field is added to the public result contract.

## Compatibility boundary

The Phase 2D.5 compatibility runner does not yet consume Module A's modifiers. Public scores, events, commentary, statistics, persistence rows and replay/report contracts therefore remain unchanged, and the PR #31 golden fingerprints must stay green.

Later PR #32 milestones can replace compatibility calculations incrementally only after calibration proves that the constitutional tactical outputs behave correctly.

No database migration or deployment action is required.
