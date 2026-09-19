# Production turn worker

The published `scheduled-world-turn` function is deliberately a lightweight Netlify scheduled-function dispatcher. Netlify scheduled functions have a short execution window, while canonical world turns can include match simulation, a large checkpoint write, and bounded checksum reconciliation.

Heavy processing therefore runs in `scheduled-world-turn-background`, which has the background-function execution window. The existing turn implementation is preserved in `scheduled-world-turn-worker` and is called through a reconciliation-aware fetch boundary.

## Alpha simulation-manager switch

Controlled alpha can populate every club without an active human appointment with the deterministic matchday manager by setting:

- `TBG_ALPHA_SIMULATION_MANAGERS=true`

When enabled, unmanaged clubs are recorded with the instruction source `alpha_simulation_manager`. Human-appointed clubs remain under human control; if a human manager misses a deadline, that club continues to use the existing `deterministic_fallback` path instead of being relabelled as a simulation manager.

The switch defaults off. It is deliberately an alpha operational control, not the later caretaker-manager mechanism. Turn history records the simulated club IDs/count and the human fallback count so full-world load tests are auditable.

## Ambiguous checkpoint responses

For retriable PostgREST responses from `replace_canonical_world_checkpoint`:

- the exact expected replacement checksum proves commit success;
- the previous checksum remains pending during bounded polling;
- a third checksum is a terminal conflict;
- if the settlement window expires without certainty, manager submissions remain locked, the canonical row remains `locking`, and the turn run becomes `reconciliation_required`.

The unresolved case must not automatically reopen submissions or mark the canonical checkpoint failed. An administrator must inspect the canonical checksum and run ledger before recovery.

## Internal dispatch authentication

The scheduled dispatcher signs each background request with a short-lived HMAC derived from the existing server-only Supabase service-role secret. The raw secret is never sent in the request. The background worker rejects missing, altered, or stale signatures.
