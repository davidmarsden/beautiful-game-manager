# Persistent world operations runbook

PR #79 adds the operational layer required to run persistent worlds safely in production.

## Principles

- The canonical save in `persistent_world_saves` remains the only active world state.
- Backups are immutable copies of a validated canonical save envelope.
- Every restore, rollback or reset first creates a safety backup of the current save.
- Destructive operations require the caller's last-seen checksum. If the live checksum has changed, the operation is rejected rather than overwriting newer state.
- Restore candidates must match the same world, manager and human club.
- All operations are recorded in an immutable audit ledger.

## Scheduled monitoring and backups

`world-maintenance` runs hourly at minute 17.

For every persistent save it:

1. loads the canonical envelope and verifies its checksum;
2. validates the persistent world, five-division structure, matchday cursor and lifecycle state;
3. compares envelope identity and metadata;
4. creates a scheduled backup when the newest backup is older than `TBG_BACKUP_INTERVAL_HOURS` (24 by default);
5. raises an operational alert for invalid saves, stale saves or missing/recently overdue backups;
6. records a monitor event.

Required production environment variable:

- `SUPABASE_SERVICE_ROLE_KEY`

Optional tuning:

- `TBG_BACKUP_INTERVAL_HOURS` — default `24`;
- `TBG_STALE_SAVE_HOURS` — default `72`.

The service-role key must exist only in Netlify's encrypted environment and must never be exposed to browser code.

## Manual backup

An authenticated administrator posts to `/api/world-operations`:

```json
{
  "type": "backup",
  "world_id": "world-1",
  "manager_id": "manager-uuid",
  "reason": "before-maintenance"
}
```

The response identifies the immutable backup. No active state is changed.

## Monitoring status

Administrators can request current health, backup history and open alerts:

```text
GET /api/world-operations?world_id=world-1&manager_id=manager-uuid
```

Health is:

- `healthy` — valid save, matching metadata, fresh save and recent backup;
- `warning` — structurally valid but stale or missing a recent backup;
- `critical` — checksum, identity, load or world validation failure.

## Restore a named backup

1. Read the current save status and note its checksum.
2. Confirm the selected backup belongs to the intended world and manager.
3. Post:

```json
{
  "type": "restore",
  "world_id": "world-1",
  "manager_id": "manager-uuid",
  "backup_id": "backup-id",
  "expected_checksum": "current-checksum"
}
```

The endpoint creates a `pre_restore` safety backup before replacing the active save. A checksum mismatch aborts the operation.

## Roll back to the previous save

Rollback chooses the newest backup whose checksum differs from the active save:

```json
{
  "type": "rollback",
  "world_id": "world-1",
  "manager_id": "manager-uuid",
  "expected_checksum": "current-checksum"
}
```

A `pre_rollback` safety backup is created first. Rollback never chooses a duplicate copy of the active checksum.

## Reset or reseed a test world

Reset accepts a complete canonical save envelope for the same world and human club:

```json
{
  "type": "reset",
  "world_id": "test-world",
  "manager_id": "manager-uuid",
  "expected_checksum": "current-checksum",
  "saved_world": { "save_version": "...", "checksum": "...", "world": {} }
}
```

Use reset only for controlled test worlds. The endpoint creates a `pre_reset` backup, validates identity and checksum, then installs the replacement envelope. It cannot import another world's save under the current world ID.

## Incident response

### Portal advancement fails

1. Stop further manager actions for the affected world.
2. Run the monitor operation and inspect open alerts.
3. Export or manually back up the active save if it still validates.
4. Reproduce the failure from the save checksum and event ledger.
5. Fix the defect and test against a copy.
6. Restore the current save if no state was corrupted, otherwise restore the most recent known-good backup.
7. Advance once in a controlled session and re-run monitoring.
8. Record the incident and chosen backup in the operation ledger.

### Canonical save fails checksum or load validation

1. Do not attempt normal matchday advancement.
2. Identify the newest backup with a healthy validation result.
3. Restore it using the current metadata checksum as the optimistic lock.
4. Preserve the corrupt envelope separately for diagnosis.
5. Confirm season, phase, matchday, club identity and archive counts after restore.

### Accidental operator action

Use rollback immediately. Because every destructive operation creates a safety backup, the state immediately before the action remains available.

## Retention recommendation

The database does not automatically delete backups in this PR. Until usage data is available, retain:

- hourly or event-driven safety backups for 7 days;
- one daily backup for 90 days;
- one season-opening and one season-ending backup permanently.

A later retention job may compact redundant backups by checksum, but it must never delete a backup referenced by a restore, rollback or incident event.

## Acceptance boundary

The CI report proves:

- canonical backup creation;
- healthy and stale monitoring outcomes;
- warning alert generation;
- optimistic concurrency rejection;
- restore identity protection;
- previous-checksum rollback selection;
- reset through the same validation contract;
- mandatory pre-operation safety backups in the endpoint workflow.

This PR provides operational recovery primitives and procedures. External paging integrations, off-site encrypted object storage and point-in-time database recovery remain infrastructure follow-ups.
