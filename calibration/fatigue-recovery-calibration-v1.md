# Fatigue & Recovery Calibration v1

- Decision: **PASS**
- Baseline dials: match cost 35, recovery 9/day
- Calibrated dials: match cost 16, recovery 5/day

## Before / after

| Metric | Baseline | Calibrated |
|---|---:|---:|
| Normal XI mean 90m cost | 34.682 | 15.855 |
| Normal XI post-match mean from 100 | 65.318 | 84.145 |
| 90–100 starters: post-match range | 51.5–78.3 | 72.4–90.08 |
| 90–100 starters finishing <70 | 93.9% | 0% |
| 90–100 starters finishing <60 | 48.5% | 0% |
| Extreme XI mean 90m cost | 47.718 | 21.814 |
| Extreme XI maximum 90m cost | 52.973 | 24.216 |
| Recovery after 2 rest days | +18 | +10 |

## Ordinary congestion: three matches, two rest days between each

| Game | Baseline kickoff mean | Baseline <82 | Calibrated kickoff mean | Calibrated <82 | Calibrated mean fitness modifier |
|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 0 | 100 | 0 | 1 |
| 2 | 83.318 | 6 | 94.138 | 0 | 1 |
| 3 | 66.636 | 10 | 88.276 | 0 | 0.9837 |

## Extreme congestion: high press + fast tempo + high work rate

| Game | Kickoff mean | Kickoff minimum | Starters <82 | Mean fitness modifier |
|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 0 | 1 |
| 2 | 88.186 | 85.784 | 0 | 0.9857 |
| 3 | 76.372 | 71.568 | 10 | 0.9194 |

## Acceptance checks

- normal_mean_cost_in_target: **PASS**
- normal_starter_tail_in_target: **PASS**
- ordinary_starters_not_below_70: **PASS**
- extreme_load_costs_more: **PASS**
- extreme_load_can_exceed_normal_ceiling: **PASS**
- two_days_recovery_meaningful: **PASS**
- ordinary_two_day_congestion_not_compulsory_rotation: **PASS**
- repeated_extreme_congestion_creates_rotation_pressure: **PASS**
- baseline_materially_reduced: **PASS**

## Interpretation

- The old curve made ordinary fatigue behave like exceptional congestion: a normal XI lost about 35 fitness points on average and most 90–100 starters fell below 70 after one match.
- The calibrated curve keeps normal full-match losses in the intended band while preserving workload differentiation: goalkeepers remain cheapest, wide/box-to-box roles cost more, and high pressing + fast tempo can still exceed the ordinary ceiling.
- Two rest days now restore 10 points. Ordinary starters can usually repeat without automatic rotation, while repeated extreme-intensity congestion pushes most of the XI below the manager AI rotation threshold by the third match.
- Fitness still affects match strength through the existing modifier curve; the recalibration changes depletion/recovery, not the constitutional relationship between fatigue and performance.
