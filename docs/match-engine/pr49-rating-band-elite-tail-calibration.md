# PR #49 — Rating-band and elite-tail calibration

## Purpose

This increment calibrates the constitutional match engine against the agreed TBG hierarchy rather than treating every small quality difference as effectively interchangeable.

## Canonical validation bands

The executable calibration fixture uses representative points within the agreed ranges:

| Band | Representative rating |
|---|---:|
| D1 elite tail | 95 |
| Typical D1 starter | 91 |
| Typical D2 starter | 89 |
| Lower-division senior floor | 85 |
| Established 19–21 youth player | 76 |
| Newly discovered 15–18 youth player | 68 |

These are calibration fixtures, not replacements for the complete player-rating constitution or the live player database.

## Bounded Module B calibration

Module B still resolves player ability, form, positional suitability, unit quality and depth in the established way. A deterministic rating-band layer then compares the two raw team-strength values and applies a symmetric multiplier:

- 1.25% per raw rating point;
- equal teams remain exactly equal;
- the stronger and weaker adjustments are symmetric;
- each side is capped between 0.88 and 1.12;
- the raw strengths remain present in the module output for auditability.

The cap is deliberate. It creates visible separation without allowing reputation or a large rating gap to make a result certain.

## Mirrored-match validation

Every scenario alternates which side is home, cancelling systematic home advantage across the sample. The harness measures:

- stronger-team win, draw, upset and non-loss rates;
- goals per match for each band;
- goal-difference gradient;
- adjacent senior-band behaviour;
- D1 elite-tail separation;
- retained upset possibility;
- youth progression and uncertainty.

The existing upset-curve validator is also promoted from a recorded pre-calibration finding to a passing gate.

## Boundary

PR #49 calibrates rating gradients. It does not yet produce persistent JSON, CSV and Markdown release artifacts or compare them with a stored accepted baseline. That remains PR #50.
