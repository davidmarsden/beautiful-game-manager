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

function world(worldId = 'pr79-world') {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({ worldId, divisions, humanClubId: divisions[0].clubs[0].club_id, movementCount: 1 });
}

function stored(source, updatedAt = '2026-07-22T10:00:00.000Z') {
  const envelope = JSON.parse(savePersistentWorld(source));
  return {
    world_id: source.world_id,
    manager_id: '11111111-1111-1111-1111-111111111111',
    club_id: source.human_club_id,
    save_version: envelope.save_version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    updated_at: updatedAt
  };
}

test('builds an immutable canonical backup record', () => {
  const source = stored(world());
  const backup = buildWorldBackupRecord(source, {
    backupId: 'backup-1', trigger: 'manual', reason: 'before_test', createdAt: '2026-07-22T11:00:00.000Z'
  });
  assert.equal(backup.backup_id, 'backup-1');
  assert.equal(backup.world_id, source.world_id);
  assert.equal(backup.save_checksum, source.save_checksum);
  assert.equal(backup.source, 'manual');
  assert.equal(backup.phase, 'preseason');
});

test('monitor validates metadata, freshness and backup coverage', () => {
  const source = stored(world());
  const backup = buildWorldBackupRecord(source, { createdAt: '2026-07-22T10:30:00.000Z' });
  const healthy = inspectPersistentSave(source, { now: '2026-07-22T11:00:00.000Z', latestBackup: backup });
  assert.equal(healthy.severity, 'healthy');
  assert.equal(Object.values(healthy.checks).every(Boolean), true);
  const warning = inspectPersistentSave(source, { now: '2026-07-24T11:00:00.000Z', latestBackup: backup });
  assert.equal(warning.severity, 'warning');
  assert.equal(buildMonitoringAlert(warning).severity, 'warning');
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

test('restore rejects backups from a different world', () => {
  const current = stored(world('world-a'));
  const foreign = buildWorldBackupRecord(stored(world('world-b')));
  assert.throws(() => buildRestorePlan(current, foreign, { expectedChecksum: current.save_checksum }), /different world/);
});

test('rollback selects the newest backup with a different checksum', () => {
  const source = stored(world());
  const first = buildWorldBackupRecord(source, { backupId: 'first', createdAt: '2026-07-22T09:00:00.000Z' });
  const advanced = stored(advancePersistentMatchday(world()).world);
  const second = buildWorldBackupRecord(advanced, { backupId: 'second', createdAt: '2026-07-22T10:00:00.000Z' });
  const duplicateCurrent = { ...second, backup_id: 'current-copy', created_at: '2026-07-22T11:00:00.000Z' };
  assert.equal(selectRollbackBackup([first, second, duplicateCurrent], advanced.save_checksum).backup_id, 'first');
});

test('reset uses the same identity and concurrency protections as restore', () => {
  const currentWorld = advancePersistentMatchday(world()).world;
  const current = stored(currentWorld);
  const clean = savePersistentWorld(world());
  const plan = buildResetPlan(current, clean, { expectedChecksum: current.save_checksum, requestedAt: '2026-07-22T13:00:00.000Z' });
  assert.equal(plan.operation_type, 'reset');
  assert.equal(plan.replacement.phase, 'preseason');
  assert.equal(plan.checks.world_identity_preserved, true);
});
