# Portal persistent-world control surface

PR #78 makes the authenticated manager portal the control surface for a persistent save.

## Manager controls

The new **World Control** view provides:

- load the latest canonical save;
- import an accepted save for an appointment with no save yet;
- export the current canonical save envelope;
- advance exactly one matchday across all five divisions;
- register or unregister an owned active player;
- renew an owned active player's contract for one to five seasons;
- buy or sell an active player during an open transfer window.

Every successful mutation is saved immediately and returns the new checksum and world summary.

## Authority and safety

The Netlify endpoint authenticates the Supabase user, resolves the active manager appointment and only permits control of that appointment's human club. A save whose `human_club_id` does not match the appointment is rejected.

Squad, contract and transfer commands are accepted only at a persistent checkpoint. Lifecycle-inactive and retired players cannot be registered, renewed or transferred. Existing squad-cycle registration limits, transfer windows, contract validation and persistent-world integrity checks remain authoritative.

## Storage

`persistent_world_saves` stores one canonical save per manager and world. Row-level security restricts reads and writes to the manager profile belonging to the authenticated user. The row retains the save version, checksum, envelope, season, phase and matchday metadata.

## Transaction boundary

A portal command follows this sequence:

1. authenticate the manager and active appointment;
2. load the current saved envelope;
3. validate the persistent world;
4. execute one domain command;
5. validate and canonically serialise the result;
6. upsert the new envelope and checksum;
7. return the updated summary to the portal.

The portal never edits raw world JSON directly after import. All subsequent mutations pass through the domain control module.

## Scope boundary

This is the first operational portal control surface. Transfer negotiation, bids awaiting acceptance, finances, board approval, multiplayer concurrency and administrator rollback remain later work. The current transfer command executes an already-agreed deterministic transfer immediately when the window and squad rules permit it.
