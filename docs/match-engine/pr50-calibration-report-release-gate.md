# PR #50 — Calibration report and release gate

PR #50 consolidates the constitutional-engine validation built in PRs #39 and #43–#49 into one reproducible release report.

## Command

```bash
npm run calibration:report
```

The command writes:

- `calibration/generated/calibration-report.json`
- `calibration/generated/calibration-report.csv`
- `calibration/generated/calibration-report.md`

CI runs the command after the full test suite and uploads the generated directory as the `calibration-report` artifact.

## Report sections

The release report includes:

1. broad match-distribution calibration;
2. Gold Standard Stress Tests 1–3;
3. tactical diversity and anti-dominance;
4. adjacent strength-gap and upset curves;
5. stateful full-season simulation;
6. divisional, youth and D1 elite-tail rating bands.

## Baseline comparison

`calibration/baselines/release-gate-v1.json` is the accepted release profile. It records:

- required report sections;
- required section acceptance states;
- bounded release metrics;
- the cutover prerequisites that are and are not yet complete.

CI fails when a required section fails or a tracked release metric leaves its accepted range.

## Cutover boundary

Passing PR #50 means the technical calibration gate is green. It does **not** make `constitutional-v1` the default.

The report deliberately returns `hold_for_shadow_comparison` because the roadmap still requires comparison against the live compatibility engine. PR #51 owns the final default switch and must retain a reversible compatibility fallback.
