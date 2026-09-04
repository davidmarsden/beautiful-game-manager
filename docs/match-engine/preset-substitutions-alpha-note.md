# Preset substitutions — alpha follow-up

This is deliberately **not** implemented in PR #395. It is a separate match-management feature.

The Match Engine Constitution already fixes the principle in Part 6 — Match Plans and Substitutions: managers may define conditional match instructions, substitutions and game-state responses in advance; the engine executes them automatically when the conditions are met. This preserves No Tactical Omniscience and avoids any advantage from being online during a live match.

## Alpha product direction

Replace the current opaque fully automatic substitution behaviour with manager-authored pre-match substitution plans.

A first usable slice should support:

- a planned minute/window (for example 60–70 minutes);
- player off and player on;
- optional score-state condition: always, winning, drawing, losing;
- sensible eligibility checks at submission time and again when the trigger fires;
- skip/fallback behaviour if either player is unavailable, already substituted, dismissed or otherwise cannot take part;
- deterministic ordering when several plans become eligible at once;
- clear indication in Team Selection that these are **pre-set** instructions, not live match controls.

Later slices can add richer conditions such as fatigue thresholds, card/dismissal state, formation/tactical changes and chained game-state plans.

The match engine remains authoritative: a saved plan is an instruction to attempt a substitution when its condition is met, not a guarantee that an impossible substitution will be forced.
