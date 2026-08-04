# Production turn worker

The published `scheduled-world-turn` function is deliberately a lightweight Netlify scheduled-function dispatcher. Netlify scheduled functions have a short execution window, while canonical world turns can include match simulation, a large checkpoint write, and bounded checksum reconciliation.

Heavy processing therefore runs in `scheduled-world-turn-background`, which has the background-function execution window. The existing turn implementation is preserved in `scheduled-world-turn-worker` and is called through a reconciliation-aware fetch boundary.

## Ambiguous checkpoint responses

For retriable PostgREST responses from `replace_canonical_world_checkpoint`:

- the exact expected replacement checksum proves commit success;
- the previous checksum remains pending during bounded polling;
- a third checksum is a terminal conflict;
- if the settlement window expires without certainty, manager submissions remain locked, the canonical row remains `locking`, and the turn run becomes `reconciliation_required`.

The unresolved case must not automatically reopen submissions or mark the canonical checkpoint failed. An administrator must inspect the canonical checksum and run ledger before recovery.

## Internal dispatch authentication

The scheduled dispatcher signs each background request with a short-lived HMAC derived from the existing server-only Supabase service-role secret. The raw secret is never sent in the request. The background worker rejects missing, altered, or stale signatures.
