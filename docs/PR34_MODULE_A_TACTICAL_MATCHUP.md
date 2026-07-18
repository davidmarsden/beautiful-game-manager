# PR #34 — Module A tactical matchup

This PR completes Module A's internal tactical-resolution contract by making the concepts introduced in PR #32 interact with the opposition.

## What it calculates

For each side, Module A now resolves five legible matchup axes:

- **Midfield control** — formation midfield weight, pivot family and style control against the opponent's equivalent.
- **Style interaction** — a published soft-counter matrix between possession, counter/transition, direct, high press, low block and balanced.
- **Route interaction** — Central, Balanced or Wide against the opponent's defensive base, including formation-route fit.
- **Transition threat** — the attacking side's transition threat against the opponent's defensive risk.
- **Pressing interaction** — the upside of a high press reduced when direct or transition play can bypass it.

The axes produce bounded home and away tactical advantages and an equal-and-opposite net advantage. Every side also records a countervailing exposure.

## Constitutional safeguards

- No matchup component exceeds its published local bound.
- Net tactical advantage is capped at ±0.15.
- Balanced remains robust-not-optimal: it avoids severe route penalties but cannot achieve committed-route upside.
- No style, formation family or route is a universal solution.
- Tactical output remains immutable and deterministic.

## Compatibility boundary

The matchup is written to:

`context.state.module_a_tactical_resolution.matchup`

It is deliberately marked `applied_to_public_result: false`. The Phase 2D.5 compatibility runner remains the sole producer of scores, events, commentary and statistics until Modules B–F are ready to consume the constitutional outputs together.

No migration is required. Golden result fingerprints must remain unchanged.
