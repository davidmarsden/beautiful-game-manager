# Constitutional Engine Operations Runbook

## Purpose

This runbook records how the constitutional match engine is monitored, how an incident is assessed and how new matches are returned to the compatibility engine without corrupting completed results.

## Engine modes

- Default: `constitutional-v1`
- Explicit fallback: `compatibility`

The public entry point continues to accept either `engine_mode` or `match_engine_mode`. A rollback changes the mode on **new match contracts only**. Completed matches are immutable: do not replay or overwrite an already-published result merely because the active engine mode changes.

## Rollback trigger

Rollback is justified when any hard invariant fails, including:

- a match cannot be resolved;
- the public result contract is invalid;
- an unavailable player is selected;
- match state is applied twice;
- fixture or public event identity collides;
- manager decisions do not reconcile at two per fixture;
- scoring, draw or home-win behaviour leaves the declared release band and the drift cannot be explained safely.

Statistical drift alone should first trigger investigation. Contract corruption, duplicate state application or untrustworthy published results trigger immediate rollback for subsequent fixtures.

## Rollback procedure

1. Stop dispatching new constitutional match contracts.
2. Preserve the failing contract, world snapshot, run key, output, logs and current calibration artifacts.
3. Set `engine_mode: "compatibility"` (or `match_engine_mode`) on newly dispatched contracts.
4. Confirm a known fixture resolves under compatibility mode and retains the established public envelope.
5. Record the incident window and the first fixture resolved under fallback.
6. Diagnose on a branch; add a regression test reproducing the failure.
7. Run `npm run calibration:gate` and regenerate the release-candidate manifest.
8. Restore `constitutional-v1` only after the release candidate is accepted.

## Data preservation

A rollback must preserve:

- fixture IDs and run keys;
- published scorelines and event identities;
- persisted fitness, injury and discipline state;
- manager-decision and availability audit records;
- the complete failed-release calibration artifact bundle.

Rollback is a routing change, not a database rewrite.

## Monitoring contract

Record these metrics by release, engine mode and competition:

- `matches_resolved_total`
- `resolution_failures_total`
- `average_goals_per_match`
- `home_win_rate`
- `draw_rate`
- `stronger_team_non_loss_rate`
- `emergency_youth_per_team_fixture`
- `out_of_position_starters_total`
- `unavailable_selections_total`
- `duplicate_state_applications_total`
- `manager_decisions_per_fixture`
- `public_contract_errors_total`

Release bands:

| Metric | Accepted band |
|---|---:|
| Average goals per match | 1.50–3.50 |
| Draw rate | 0.15–0.40 |
| Home-win rate | 0.20–0.55 |
| Emergency youth per team-fixture | ≤0.20 |
| Manager decisions per fixture | exactly 2 |
| Resolution failures | 0 |
| Unavailable selections | 0 |
| Duplicate state applications | 0 |
| Public-contract errors | 0 |

## Review cadence

- Per deployment: run the complete calibration gate and archive its artifacts.
- Per matchday: inspect hard invariants and compare headline rates with the accepted release candidate.
- Per season: compare outcome, availability, rotation, emergency-youth and out-of-position trends with the 50-season soak baseline.

## Return-to-service criteria

The constitutional engine may return after:

- the incident has a documented cause;
- a regression test covers it;
- the complete calibration gate passes;
- shadow comparison remains accepted;
- the release-candidate manifest is regenerated and accepted;
- the first restored fixtures are observed without hard-invariant failures.
