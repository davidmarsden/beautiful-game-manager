# PR #63 — Constitutional engine release candidate

## Release decision

The constitutional engine is recorded as `constitutional-engine-rc1` with `constitutional-v1` as the default match mode and `compatibility` retained as the explicit operational fallback.

This release candidate follows the accepted engine cutover, autonomous-season integration, 50-season soak and final outcome calibration work. PR #60 already established the selection fallback hierarchy: natural positions, supported alternatives, senior out-of-position cover and deterministic temporary emergency youth only when necessary.

## Required evidence

A release candidate is accepted only when all required generated artifacts are both present and accepted:

1. Core calibration report.
2. Shadow comparison.
3. Complete five-division league structure.
4. Promotion, relegation and rollover.
5. Season availability integration.
6. Deterministic manager decisions.
7. Autonomous AI season integration.
8. Fifty-season soak.
9. Final outcome calibration.

The executable manifest records each artifact's filename, version, presence and acceptance state. Missing or failed evidence blocks release.

## Generated outputs

`npm run release-candidate:constitutional` produces:

- `calibration/generated/constitutional-release-candidate.json`
- `calibration/generated/constitutional-release-candidate.md`

CI runs this after all prerequisite calibration reports have been generated and before artifacts are uploaded.

## Rollback

Rollback is deliberately boring and reversible:

- route new contracts with `engine_mode: "compatibility"`;
- leave completed constitutional results untouched;
- preserve fixture identities, run keys, state and audit evidence;
- repair on a branch with a regression test;
- rerun the complete calibration gate;
- regenerate an accepted release-candidate manifest before restoration.

The detailed procedure is in `constitutional-engine-operations-runbook.md`.

## Monitoring

The release candidate records a versioned monitoring contract covering:

- resolution failures;
- goals, draw and home-win rates;
- stronger-team non-loss behaviour;
- emergency youth and out-of-position use;
- unavailable selections;
- duplicate state application;
- manager decisions per fixture;
- public-contract errors.

Hard integrity failures have zero tolerance. Statistical bands match the accepted autonomous-season and multi-season calibration gates.

## Scope boundary

This PR does not change match resolution, selection or outcome calibration. It packages the already accepted constitutional engine as an auditable release candidate and records how it is observed and safely rolled back.
