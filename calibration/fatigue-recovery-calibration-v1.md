# Fatigue & Recovery Calibration v1

- Decision: **PASS**
- Baseline dials: match cost 35, recovery 9/day
- Calibrated dials: match cost 16, recovery 5/day
- Scope: 4-3-3-wide representative XI; role, pressing, tempo and work-rate multipliers are the live Module C formula.

## Before / after

| Metric | Baseline | Calibrated |
|---|---:|---:|
| Normal XI mean 90m cost | 34.682 | 15.855 |
| Normal XI cost range | 21.700–38.500 | 9.920–17.600 |
| Normal XI post-match mean from 100 | 65.318 | 84.145 |
| 90–100 starters: post-match range | 51.500–78.300 | 72.400–90.080 |
| 90–100 starters finishing <70 | 93.9% | 0.0% |
| 90–100 starters finishing <60 | 48.5% | 0.0% |
| 90–100 starters finishing <50 | 0.0% | 0.0% |
| Low press + slow tempo mean cost | 29.176 | 13.338 |
| Extreme high-press/fast-tempo mean cost | 47.718 | 21.814 |
| Extreme maximum 90m cost | 52.971 | 24.215 |
| Recovery after 2 rest days | +18 | +10 |
| Recovery after 3 rest days | +27 | +15 |

## Ordinary congestion: three matches, two rest days between each

The existing AI rotates more aggressively below 82 fitness. This block shows the fitness pressure seen at kick-off if the same XI is retained.

| Game | Baseline kickoff mean | Baseline starters <82 | Calibrated kickoff mean | Calibrated starters <82 | Calibrated mean fitness modifier |
|---:|---:|---:|---:|---:|---:|
| 1 | 100.000 | 0 | 100.000 | 0 | 1.0000 |
| 2 | 83.318 | 6 | 94.138 | 0 | 1.0000 |
| 3 | 66.636 | 10 | 88.276 | 0 | 0.9837 |

Under the old curve, ordinary congestion forced rotation almost immediately and materially weakened a retained XI by the third game. Under the calibrated curve, two-day congestion is survivable without making rotation compulsory, while fitness still begins to affect performance by the third consecutive match.

## Extreme congestion: high press + fast tempo + high work rate

| Game | Kickoff mean | Kickoff minimum | Starters <82 | Mean fitness modifier |
|---:|---:|---:|---:|---:|
| 1 | 100.000 | 100.000 | 0 | 1.0000 |
| 2 | 88.186 | 85.785 | 0 | 0.9857 |
| 3 | 76.372 | 71.569 | 10 | 0.9194 |

The demanding tactical path therefore remains costly: repeated extreme-intensity matches still create a clear rotation incentive and a meaningful competitive penalty.

## Role and tactical differentiation

At 100 fitness, normal press/tempo and work rate 50:

- goalkeeper: 9.920 points
- centre-back: 14.720
- defensive midfield / striker: 16.000
- full-back / central midfield: 16.960
- winger: 17.600

At high press + fast tempo with work rate 80:

- goalkeeper: 13.649
- centre-back: 20.253
- defensive midfield / striker: 22.014
- full-back / central midfield: 23.335
- winger: 24.215

This preserves the constitutional intent that role and tactics matter without making ordinary football behave like exceptional congestion.

## Acceptance checks

- normal mean 90m cost roughly 10–22: **PASS**
- normal 90–100 starters finish in a realistic broad band: **PASS**
- ordinary starters routinely below 70 after one match: **NO — PASS**
- high press / fast tempo / demanding roles cost more: **PASS**
- exceptional workloads can exceed the ordinary ceiling: **PASS**
- two rest days restore a meaningful amount (+10): **PASS**
- ordinary congestion does not force immediate rotation: **PASS**
- repeated extreme congestion creates clear rotation pressure: **PASS**
- recalibration materially reduces the old exhaustion curve: **PASS**

## Interpretation

The old `35 / 9` pair mixed two compensating extremes: matches removed far too much fitness, then rest restored it extremely quickly. This produced implausibly low post-match condition and excessive sensitivity to fixture spacing.

The calibrated `16 / 5` pair makes the match cost itself realistic. A reasonably fit starter beginning between 90 and 100 now normally finishes between roughly 72 and 90 depending on role and workload. Recovery remains meaningful but no longer has to undo an exaggerated match penalty.

No change is made to the existing fitness-to-performance modifier, sharpness, morale, injury formula, cohesion/familiarity narrowing or manager rotation threshold. This is a dial recalibration, not a structural Match Engine rule change.
