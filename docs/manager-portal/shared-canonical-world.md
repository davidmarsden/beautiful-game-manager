# Shared canonical world

PR #81 corrects the portal persistence model to match TBG and Soccer Manager Worlds.

## Governing model

TBG is one shared, turn-based world. A manager does not own a private save and cannot decide when fixtures are played.

- One `canonical_world_saves` row exists per world.
- Managers can read the current canonical checkpoint.
- Managers submit club instructions and world commands before a shared deadline.
- A trusted scheduled function locks the turn and advances the whole world.
- Missing submissions use deterministic fallback behaviour.
- Backup, restore, rollback, reset, import and direct advancement are administrator-only operations.

## Manager submissions

`manager_turn_submissions` stores one current submission per club, season and matchday. Managers may revise it while the turn is open. At the deadline it becomes locked and is later marked consumed.

The manager portal therefore shows:

- the current shared season and matchday;
- the next scheduled turn and countdown;
- the club's submission state;
- controls for submitting team instructions;
- registration, contract and transfer requests.

It no longer exposes Load, Export, Import or Advance World controls.

## World commands

Registration, contract and transfer requests are stored in `manager_world_commands`. They are not direct browser mutations of a manager-owned save. The scheduled processor applies validated commands against the one canonical world before the matchday transaction.

A transfer offer does not unilaterally take a player from another human manager. Negotiation and acceptance policy can mature independently while retaining the shared command-ledger boundary.

## Scheduled processing

`scheduled-world-turn` checks every fifteen minutes for worlds whose `next_turn_at` has passed. For each due world it:

1. claims the canonical checkpoint using its checksum and open status;
2. reads pending club submissions and commands;
3. locks the submissions;
4. applies valid commands at the safe checkpoint;
5. advances one matchday across all divisions;
6. writes one replacement canonical save with optimistic checksum protection;
7. consumes submissions and records a `world_turn_runs` audit row;
8. schedules the next turn.

The default schedule targets Tuesday and Friday at 20:00 UTC and can be configured with `TBG_TURN_DAYS` and `TBG_TURN_HOUR_UTC`.

## Migration warning

Do not manually deploy `20260722_pr78_persistent_world_saves.sql` by itself. PR #81 supersedes and removes the per-manager `persistent_world_saves` table. Deploy migrations through the PR #81 migration state so the shared tables and operational adaptations are created together.

## Current engine boundary

The persistent matchday engine still contains one legacy designated human-control slot in the canonical world contract. PR #81 moves ownership, scheduling, storage and submissions to the correct multi-manager architecture and retains every club submission in the shared turn ledger. Expanding direct line-up application from the legacy slot to every human-appointed club remains an engine-integration follow-up; no manager can create a private timeline or trigger a fixture in the meantime.
