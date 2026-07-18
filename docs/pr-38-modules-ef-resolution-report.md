# PR #38 — Modules E and F: Resolution and Report

## Purpose

This PR completes the internal A–F constitutional match-engine chain.

Module E takes Module D's provisional stream, validates it, resolves the official internal score, reconciles statistics and publishes projected state changes. Module F turns that resolved state into factual commentary and a structured match report.

## Module E — Match Resolution

Module E:

- rejects missing, duplicate or malformed event identities;
- validates event side, type and minute;
- rejects internally impossible goal records;
- orders events chronologically;
- removes provisional status and marks accepted events official;
- derives the score exclusively from official goal events;
- reconciles shots, shots on target, xG, set pieces, discipline and injuries;
- verifies score/event/statistical consistency;
- publishes projected fitness, injury and disciplinary changes for a later persistence boundary.

The immutable result is stored at:

`context.state.module_e_match_resolution`

## Module F — Commentary and Report

Module F consumes only completed Module E state. It produces:

- a result headline;
- a factual match summary;
- a selected chronological commentary stream;
- resolved player and club names where available;
- talking points grounded in tactical, quality and statistical state;
- the reconciled statistics table;
- tactical and condition context.

The immutable result is stored at:

`context.state.module_f_commentary_report`

## Public transition boundary

This PR completes the constitutional engine internally but does not switch the existing public result contract during the same change. The compatibility runner remains active while PR #39 calibrates distributions and validates the new engine against the gold standard.

Module E and Module F therefore carry:

- `applied_to_public_result: false`;
- `public_contract_transition_pending: true` on the report.

This prevents an uncalibrated engine from silently changing live scores while making the complete replacement engine available for calibration and inspection.

No migration required.
