# Canonical world initialization

The shared-world schema begins empty by design. PR #84 adds a one-time administrator operation that creates the first authoritative persistent world from the approved published world data.

## Authority

Only an authenticated manager profile with `is_admin = true` and an active world appointment can initialize a world. Ordinary managers receive a read-only empty-state message and no initialization control.

## Source and validation

The initializer reads the configured `TBG_WORLD_URL` publication, then:

- resolves the five published divisions;
- uses stable club and player IDs;
- uses the publication ownership ledger to prevent duplicate ownership;
- requires every club to have at least 18 usable players;
- registers no more than the configured registration limit;
- creates the five-division persistent world with four promotion/relegation places per boundary by default;
- validates and round-trips the canonical save envelope before any database write.

## Atomic write

The service-role-only `initialize_canonical_world` database function writes, in one transaction:

1. the single `canonical_world_saves` row;
2. the immutable opening backup;
3. the initialization audit event.

The operation refuses to run when a canonical row already exists. A partial world cannot be left behind if the backup or audit write fails.

## Portal

Before initialization, administrators see **Initialize canonical world**. Other managers see that the world has not yet been initialized. After success, the control disappears and the ordinary shared-world deadline and submission interface loads.

The internal setup token previously displayed beneath the world name is no longer shown, and the redundant manager-facing explanation of administrator-only save operations has been removed.
