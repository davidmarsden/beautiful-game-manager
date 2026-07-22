import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday } from '../src/world/persistentMatchdayWorld.js';
import { savePersistentWorld } from '../src/world/persistentSeasonLoop.js';
import {
  buildMonitoringAlert,
  buildResetPlan,
  buildRestorePlan,
  buildWorldBackupRecord,
  inspectPersistentSave,
  selectRollbackBackup
} from '../src/world/worldOperations.js';
import { conditionalReplacementPath } from '../netlify/functions/world-operations.mjs';

const MANAGER_ID = '11111111-1111-1111-1111-111111111111';

function world(worldId = 'pr79-world') {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId,
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function stored(source, updatedAt = '2026-07-22T10:00:00.000Z') {
  const envelope = JSON.parse(savePersistentWorld(source));
  return {
    world_id: source.world_id,
    manager_id: MANAGER_ID,
    club_id: source.human_club_id,
    save_version: envelope.save_version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    season_id: source.squad_cycle.season_id,
    season_number: source.season_number,
    phase: source.phase,
    matchday: source.matchday_cycle?.current_matchday || null,
    updated_at: updatedAt
  };
}

test('backup records preserve the canonical envelope and metadata', () => {
  const source = stored(world());
  const backup = buildWorldBackupRecord(source, {
    backupId: 'backup-one',
    trigger: 'manual',
    reason: 'operator_test',
    createdAt: '2026-07-22T10:05:00.000Z',
    createdBy: MANAGER_ID
  });
  assert.equal(backup.backup_id, 'backup-one');
  assert.equal(backup.world_id, source.world_id);
  assert.equal(backup.save_checksum, source.save_checksum);
  assert.deepEqual(backup.save_envelope, source.save_envelope);
});

test('monitor validates metadata, freshness and backup coverage', () => {
  const source = stored(world());
  const backup = buildWorldBackupRecord(source, { createdAt: '2026-07-22T10:05:00.000Z' });
  const inspection = inspectPersistentSave(source, {
    now: '2026-07-22T11:00:00.000Z',
    latestBackup: backup
  });
  assert.equal(inspection.severity, 'healthy');
  assert.equal(Object.values(inspection.checks).every(Boolean), true);
  assert.equal(buildMonitoringAlert(inspection), null);
});

test('monitor detects corrupted metadata without mutating the save', () => {
  const source = stored(world());
  const broken = { ...source, save_checksum: 'not-the-envelope-checksum' };
  const inspection = inspectPersistentSave(broken, { now: source.updated_at, latestBackup: buildWorldBackupRecord(source) });
  assert.equal(inspection.severity, 'critical');
  assert.equal(inspection.checks.checksum_matches_metadata, false);
  assert.match(inspection.errors.join(' '), /checksum/);
});

test('restore requires optimistic checksum match and preserves world identity', () => {
  const opening = stored(world());
  const advancedWorld = advancePersistentMatchday(world()).world;
  const current = stored(advancedWorld, '2026-07-22T12:00:00.000Z');
  const backup = buildWorldBackupRecord(opening, { backupId: 'opening-backup' });
  assert.throws(() => buildRestorePlan(current, backup, { expectedChecksum: 'stale-checksum' }), /changed/);
  const plan = buildRestorePlan(current, backup, { expectedChecksum: current.save_checksum, requestedAt: '2026-07-22T12:30:00.000Z' });
  assert.equal(plan.accepted, true);
  assert.equal(plan.replacement.world_id, current.world_id);
  assert.equal(plan.replacement.club_id, current.club_id);
  assert.notEqual(plan.previous_checksum, plan.replacement_checksum);
});

test('replacement database write is conditional on the previously inspected checksum', () => {
  const opening = stored(world('world with spaces'));
  const current = stored(advancePersistentMatchday(world('world with spaces')).world);
  const backup = buildWorldBackupRecord(opening, { backupId: 'conditional-backup' });
  const plan = buildRestorePlan(current, backup, { expectedChecksum: current.save_checksum });
  const path = conditionalReplacementPath(plan);
  assert.match(path, /world_id=eq\.world%20with%20spaces/);
  assert.doesNotMatch(path, /manager_id=/);
  assert.match(path, new RegExp(`save_checksum=eq\.${plan.previous_checksum}`));
  assert.doesNotMatch(path, /on_conflict/);
});

test('restore rejects backups from a different world', () => {
  const current = stored(world('world-a'));
  const foreign = buildWorldBackupRecord(stored(world('world-b')));
  assert.throws(() => buildRestorePlan(current, foreign, { expectedChecksum: current.save_checksum }), /different world/);
});

test('rollback chooses the newest backup with a different checksum', () => {
  const source = stored(world());
  const current = stored(advancePersistentMatchday(world()).world, '2026-07-22T12:00:00.000Z');
  const same = buildWorldBackupRecord(current, { backupId: 'same', createdAt: '2026-07-22T12:10:00.000Z' });
  const older = buildWorldBackupRecord(source, { backupId: 'older', createdAt: '2026-07-22T10:00:00.000Z' });
  assert.equal(selectRollbackBackup([same, older], current.save_checksum).backup_id, 'older');
});

test('reset requires the same world identity', () => {
  const current = stored(advancePersistentMatchday(world()).world);
  const reset = stored(world());
  const plan = buildResetPlan(current, reset, { expectedChecksum: current.save_checksum });
  assert.equal(plan.accepted, true);
  assert.equal(plan.operation_type, 'reset');
  assert.throws(() => buildResetPlan(current, stored(world('other-world')), { expectedChecksum: current.save_checksum }), /different world/);
});
