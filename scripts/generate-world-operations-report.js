import fs from 'node:fs';
import path from 'node:path';
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

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({ worldId: 'world-operations-acceptance', divisions, humanClubId: divisions[0].clubs[0].club_id, movementCount: 1 });
}

function stored(source, updatedAt) {
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

const opening = stored(world(), '2026-07-22T09:00:00.000Z');
const openingBackup = buildWorldBackupRecord(opening, {
  backupId: 'acceptance-opening-backup',
  trigger: 'scheduled',
  reason: 'acceptance_baseline',
  createdAt: '2026-07-22T09:05:00.000Z'
});
const healthy = inspectPersistentSave(opening, {
  now: '2026-07-22T10:00:00.000Z', latestBackup: openingBackup
});
const advancedWorld = advancePersistentMatchday(world()).world;
const current = stored(advancedWorld, '2026-07-22T11:00:00.000Z');
const preRestoreBackup = buildWorldBackupRecord(current, {
  backupId: 'acceptance-pre-restore', trigger: 'pre_restore', reason: 'restore_safety_backup', createdAt: '2026-07-22T11:05:00.000Z'
});
const restore = buildRestorePlan(current, openingBackup, {
  expectedChecksum: current.save_checksum, requestedAt: '2026-07-22T11:10:00.000Z'
});
const rollbackSelected = selectRollbackBackup([openingBackup, preRestoreBackup], current.save_checksum);
const rollback = buildRestorePlan(current, rollbackSelected, {
  expectedChecksum: current.save_checksum, requestedAt: '2026-07-22T11:15:00.000Z', mode: 'rollback'
});
const reset = buildResetPlan(current, savePersistentWorld(world()), {
  expectedChecksum: current.save_checksum, requestedAt: '2026-07-22T11:20:00.000Z'
});
const stale = inspectPersistentSave(opening, {
  now: '2026-07-25T10:00:00.000Z', latestBackup: openingBackup
});
const alert = buildMonitoringAlert(stale, { alertId: 'acceptance-warning' });
let staleWriteRejected = false;
try {
  buildRestorePlan(current, openingBackup, { expectedChecksum: opening.save_checksum });
} catch {
  staleWriteRejected = true;
}

const checks = {
  healthy_save_and_backup_detected: healthy.severity === 'healthy',
  canonical_backup_created: openingBackup.save_checksum === opening.save_checksum,
  pre_restore_backup_created: preRestoreBackup.source === 'pre_restore',
  restore_plan_accepted: restore.accepted,
  restore_preserves_world_identity: restore.checks.world_identity_preserved && restore.checks.club_identity_preserved,
  rollback_selects_previous_checksum: rollbackSelected.save_checksum !== current.save_checksum,
  rollback_plan_accepted: rollback.accepted,
  reset_plan_accepted: reset.accepted && reset.operation_type === 'reset',
  stale_save_or_backup_raises_alert: stale.severity === 'warning' && alert?.severity === 'warning',
  optimistic_concurrency_blocks_stale_write: staleWriteRejected
};

const report = {
  version: 'tbg-world-operations-report-v1.0',
  generated_at: new Date().toISOString(),
  accepted: Object.values(checks).every(Boolean),
  checks,
  summary: {
    backup_checksum: openingBackup.save_checksum,
    current_checksum: current.save_checksum,
    restore_checksum: restore.replacement_checksum,
    rollback_backup_id: rollbackSelected.backup_id,
    safety_backup_id: preRestoreBackup.backup_id,
    healthy_severity: healthy.severity,
    stale_severity: stale.severity,
    restored_phase: restore.replacement.phase,
    reset_phase: reset.replacement.phase
  }
};

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, 'world-operations.json');
const markdownPath = path.join(outputDir, 'world-operations.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Persistent World Operations Acceptance\n\n- Accepted: **${report.accepted}**\n- Healthy monitor state: **${report.summary.healthy_severity}**\n- Stale monitor state: **${report.summary.stale_severity}**\n- Restore target phase: **${report.summary.restored_phase}**\n- Reset target phase: **${report.summary.reset_phase}**\n\n## Checks\n\n${Object.entries(checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Persistent world operations accepted: ${jsonPath}`);
}
