# PR #47 — Tactical diversity, anti-dominance and upset validation

This phase expands calibration from named directional stress tests to exhaustive tactical and probabilistic validation.

## Tactical matrix

The harness enumerates all supported combinations of:

- seven formations;
- six tactical styles;
- three routes to goal.

That produces 126 tactical packages and a 15,876-cell ordered matchup matrix.

The release checks require:

- every matchup to remain inside the constitutional ±0.15 tactical bound;
- home and away tactical advantages to remain equal and opposite;
- a meaningful range of distinct matchup outcomes;
- every committed tactical style to have at least one counter;
- no tactical package to beat every distinct alternative;
- the leading package to retain a genuinely negative matchup.

The matrix is diagnostic, not a declaration that all packages must win equally often. Formation suitability and squad quality remain separate from tactical matchup advantage.

## Upset curve

The upset harness runs equal-tactic fixtures across rating gaps of 2, 4, 6 and 10 points. Home advantage is neutralised by alternating the stronger team between home and away.

The checks require:

- an upset to remain possible at every tested gap;
- stronger teams never to become certain winners;
- the strongest tested rating gap to produce a better stronger-team win rate than the narrowest gap;
- the strongest tested rating gap to produce a lower upset rate than the narrowest gap;
- win, draw and upset probabilities to reconcile to one.

This validates direction and uncertainty. Final divisional and elite-tail numeric calibration remains PR #49.

## Remaining roadmap

- PR #48 — stateful full-season simulation harness;
- PR #49 — rating-band and elite-tail calibration;
- PR #50 — automatic calibration report and release gate;
- PR #51 — constitutional engine default cutover.
