# PR #46 — Gold-standard dataset and Stress Tests 1–3

This PR turns the three constitutional match-engine stress tests into executable calibration fixtures.

## Dataset

`calibration/gold-standard/match-engine-v1.json` is a versioned, directional gold standard. It records:

- Southall Town's wide, thin-depth squad from Stress Tests 1–3;
- Northfield's central-strength counterexample;
- canonical lineups for 4-3-3 Wide, 3-5-2 Wide, 4-4-2 Direct and 4-2-3-1 Central;
- the six-match/eighteen-day congestion block;
- named acceptance expectations for each stress test.

It does not claim that the current numeric dials are final. It preserves the constitutional findings as regression targets while later roadmap PRs calibrate anti-dominance, season distributions and the elite tail.

## Stress Test 1 — One Squad, Many Shapes

The executable harness checks that:

- Southall's wide 4-3-3 outperforms its central 4-2-3-1;
- Northfield's central 4-2-3-1 outperforms its wide 4-3-3;
- the best setup therefore diverges by squad;
- 4-2-3-1 is not a universal optimum.

## Stress Test 2 — Congestion, Rotation and Depth

The harness runs the same six-match block using rigid and managed-rotation selections. It checks that:

- rigid use accumulates more fatigue in identity-critical players;
- rotation preserves more whole-squad Fitness;
- high familiarity/cohesion narrows dispersion;
- using thin backup depth carries a real mean-quality cost.

## Stress Test 3 — Holding an Identity Under Congestion

The harness checks that:

- rotation preserves the same wide tactical package;
- backup players reduce mean quality without erasing club familiarity;
- wing-backs carry a higher workload than full-backs;
- managed rotation preserves more availability than rigid burnout.

## Boundary

PR #46 imports and executes the gold standard. It does not yet add the complete tactical diversity matrix, upset-factor validation, season harness, elite-tail calibration or release report. Those remain PRs #47–#50.
