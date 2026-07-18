# PR #39 — Calibration and staged public cutover

## Purpose

PR #39 gives the completed constitutional A–F engine a measurable acceptance gate and a reversible path into the existing Match Centre result contract.

It does not silently replace live results.

## Calibration profile

The baseline suite runs a balanced sample in which the stronger selected XI alternates between home and away. It measures:

- average total goals;
- draw rate;
- home-win rate;
- stronger-team non-loss rate;
- six-or-more-goal rate;
- nil-nil rate.

The ranges are deliberately broad first-release guard rails rather than claims of final calibration. They catch obvious chaos, determinism, excessive home advantage, score inflation and an engine in which player quality does not matter.

The targets are versioned in `src/matchEngine/calibration.js`. A failed target prints the complete report in CI.

## Public adapter

`runConstitutionalPublicResult(context)` maps Modules E and F into the established `2d5-v1` public envelope:

- official score and outcome;
- official event stream with commentary;
- reconciled shots, shots on target, possession and xG;
- headline, summary and talking points;
- projected state changes;
- seed commitment and engine metadata.

The score is always derived from official goal events. Public statistics come from the same resolved stream.

## Staged activation

The compatibility runner remains the default. A caller opts into the constitutional result with:

```js
contract.engine_mode = 'constitutional-v1';
```

Both modes still execute Modules A–F. The flag changes only which completed internal result is mapped into the public response.

This creates a safe sequence:

1. merge and observe the calibration suite;
2. run shadow fixtures through `constitutional-v1`;
3. review distributions and reports;
4. change the fixture runner default in a separate, explicit production cutover.

Rollback is one field change, not an engine rewrite.

## Compatibility

- default fixture behaviour remains unchanged;
- existing golden compatibility fingerprints remain valid;
- the constitutional mode preserves the `2d5-v1` result envelope;
- no database migration is required.
