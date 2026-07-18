# PR #35 — Module B: Player Quality

## Purpose

This PR replaces Module B's no-op with a deterministic internal team-quality layer. It consumes the real-world player ratings already present in the world snapshot and translates the selected XI into positional-unit and team-strength outputs for later constitutional modules.

It does not change the public match result yet.

## Rating boundary

Module B follows the Player Rating Constitution v1.1:

- **Ability** is the primary persistent quality input.
- **Form** is a small, bounded temporary adjustment.
- **Potential** is informational and never affects current match quality.
- **Reputation** describes standing and never boosts match quality.

The module does not recalculate market-value-derived ratings inside the match. It consumes the published rating snapshot deterministically.

## Role weighting

Every supported formation publishes eleven required slot roles. Each selected player is compared with the role attached to his slot:

- natural role: `1.00`;
- adjacent role: `0.96`;
- same-unit alternative: `0.91`;
- unknown position: `0.88`;
- cross-unit misuse: `0.84`;
- goalkeeper/outfield misuse: `0.72`.

This makes selection order and deployment meaningful without creating hidden player attributes.

## Team outputs

For each side Module B records:

- all eleven player-quality resolutions;
- goalkeeping, defensive, midfield and attacking unit quality;
- starting-XI quality;
- useful bench depth from the five strongest available substitutes;
- a bounded depth contribution;
- final team strength on the 1–100 scale.

The immutable result is stored at:

`context.state.module_b_player_quality`

and carries `applied_to_public_result: false` until Modules C–F are complete.

## Compatibility

No score, event, commentary, report, persistence or Match Centre contract changes. The Phase 2D.5 compatibility runner remains the sole producer of public match output and all golden fingerprints must remain unchanged.

No migration required.
