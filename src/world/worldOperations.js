import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';
import { portalWorldSummary } from './portalWorldControl.js';
import { validatePlayerLifecycleWorld } from './playerLifecycleReconciliation.js';

export const WORLD_OPERATIONS_VERSION = 'tbg-world-operations-v1.0';
export const DEFAULT_STALE_HOURS = 24;
export const DEFAULT_BACKUP_MAX_AGE_HOURS = 24;

const text = (value) => String(value ?? '').trim();

function iso(value = new Date().toISOString()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid operational timestamp: ${value}`);
  return date.toISOString();
}

function hoursBetween(earlier, later) {
  return Math.max(0, (new Date(later).getTime() - new Date(earlier).getTime()) / 3600000);
}

function envelopeObject(value) {
  if (typeof value === 'string') return JSON.parse(value);
  if (!value || typeof value !== 'object') throw new Error('Persistent save envelope is required');
  return structuredClone(value);
}

export function inspectPersistentSave(storedSave, {
  now = new Date().toISOString(),
  staleAfterHours = DEFAULT_STALE_HOURS,
  latestBackup = null,
  backupMaxAgeHours = DEFAULT_BACKUP_MAX_AGE_HOURS
} = {}) {
  const checkedAt = iso(now);
  const errors = [];
  let world = null;
  let summary = null;
  let envelope = null;
  try {
    envelope = envelopeObject(storedSave?.save_envelope ?? storedSave?.saved_world ?? storedSave);
    world = loadPersistentWorld(JSON.stringify(envelope));
    summary = portalWorldSummary(world);
  } catch (error) {
    errors.push(`Save envelope invalid: ${error.message}`);
  }
  if (world) {
    const validation = validatePlayerLifecycleWorld(world);
    if (!validation.valid) errors.push(...validation.errors.map((row) => `World validation: ${row}`));
    if (storedSave?.world_id && storedSave.world_id !== world.world_id) errors.push('Stored world_id does not match envelope world_id');
    if (storedSave?.club_id && storedSave.club_id !== world.human_club_id) errors.push('Stored club_id does not match envelope human_club_id');
    if (storedSave?.save_checksum && storedSave.save_checksum !== envelope.checksum) errors.push('Stored checksum metadata does not match envelope checksum');
    if (storedSave?.save_version && storedSave.save_version !== envelope.save_version) errors.push('Stored save version metadata does not match envelope version');
  }
  const saveAge = storedSave?.updated_at ? hoursBetween(iso(storedSave.updated_at), checkedAt) : null;
  const backupAge = latestBackup?.created_at ? hoursBetween(iso(latestBackup.created_at), checkedAt) : null;
  const checks = Object.freeze({
    envelope_loads: Boolean(world),
    world_valid: Boolean(world) && !errors.some((row) => row.startsWith('World validation:')),
    identity_matches_metadata: Boolean(world) && !errors.some((row) => row.includes('world_id') || row.includes('club_id')),
    checksum_matches_metadata: Boolean(world) && !errors.some((row) => row.includes('checksum')),
    version_matches_metadata: Boolean(world) && !errors.some((row) => row.includes('version metadata')),
    save_is_fresh: saveAge === null || saveAge <= staleAfterHours,
    recent_backup_exists: backupAge !== null && backupAge <= backupMaxAgeHours
  });
  const severity = errors.length ? 'critical' : !checks.save_is_fresh || !checks.recent_backup_exists ? 'warning' : 'healthy';
  return Object.freeze({
    version: WORLD_OPERATIONS_VERSION,
    checked_at: checkedAt,
    world_id: world?.world_id || storedSave?.world_id || null,
    manager_id: storedSave?.manager_id || null,
    club_id: world?.human_club_id || storedSave?.club_id || null,
    severity,
    errors: Object.freeze(errors),
    checks,
    metrics: Object.freeze({
      save_age_hours: saveAge === null ? null : Number(saveAge.toFixed(3)),
      backup_age_hours: backupAge === null ? null : Number(backupAge.toFixed(3)),
      save_bytes: envelope ? Buffer.byteLength(JSON.stringify(envelope)) : 0,
      season_number: summary?.season_number || null,
      current_matchday: summary?.current_matchday || null,
      phase: summary?.phase || null
    }),
    summary
  });
}

export function buildWorldBackupRecord(storedSave, {
  backupId,
  trigger = 'manual',
  reason = 'manual_backup',
  createdAt = new Date().toISOString(),
  createdBy = null
} = {}) {
  const envelope = envelopeObject(storedSave?.save_envelope ?? storedSave?.saved_world ?? storedSave);
  const world = loadPersistentWorld(JSON.stringify(envelope));
  const summary = portalWorldSummary(world);
  return Object.freeze({
    backup_id: text(backupId) || `${world.world_id}:${Date.parse(iso(createdAt))}:${envelope.checksum.slice(0, 12)}`,
    world_id: world.world_id,
    manager_id: storedSave?.manager_id || null,
    club_id: world.human_club_id,
    save_version: envelope.save_version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    source_save_updated_at: storedSave?.updated_at ? iso(storedSave.updated_at) : null,
    source: text(trigger) || 'manual',
    reason: text(reason) || 'manual_backup',
    season_id: summary.season_id,
    season_number: summary.season_number,
    phase: summary.phase,
    matchday: summary.current_matchday,
    created_by: createdBy || null,
    created_at: iso(createdAt)
  });
}

export function buildRestorePlan(currentSave, backup, {
  expectedChecksum,
  operationId,
  requestedBy,
  requestedAt = new Date().toISOString(),
  mode = 'restore'
} = {}) {
  if (!backup?.save_envelope) throw new Error('Restore requires a backup save envelope');
  if (expectedChecksum && currentSave?.save_checksum !== expectedChecksum) throw new Error('Current save changed since the operation was requested');
  const currentEnvelope = envelopeObject(currentSave.save_envelope);
  const currentWorld = loadPersistentWorld(JSON.stringify(currentEnvelope));
  const restoredWorld = loadPersistentWorld(JSON.stringify(envelopeObject(backup.save_envelope)));
  if (currentWorld.world_id !== restoredWorld.world_id) throw new Error('Backup belongs to a different world');
  if (currentWorld.human_club_id !== restoredWorld.human_club_id) throw new Error('Backup belongs to a different human club');
  if (currentSave.manager_id && backup.manager_id && currentSave.manager_id !== backup.manager_id) throw new Error('Backup belongs to a different manager');
  const restoredEnvelope = JSON.parse(savePersistentWorld(restoredWorld));
  const summary = portalWorldSummary(restoredWorld);
  const at = iso(requestedAt);
  return Object.freeze({
    version: WORLD_OPERATIONS_VERSION,
    operation_id: text(operationId) || `${mode}:${currentWorld.world_id}:${Date.parse(at)}`,
    operation_type: mode,
    world_id: currentWorld.world_id,
    manager_id: currentSave.manager_id || backup.manager_id || null,
    club_id: restoredWorld.human_club_id,
    previous_checksum: currentEnvelope.checksum,
    replacement_checksum: restoredEnvelope.checksum,
    source_backup_id: backup.backup_id || backup.id || null,
    requested_by: requestedBy || null,
    requested_at: at,
    replacement: Object.freeze({
      world_id: restoredWorld.world_id,
      manager_id: currentSave.manager_id || backup.manager_id || null,
      club_id: restoredWorld.human_club_id,
      save_version: restoredEnvelope.save_version,
      save_checksum: restoredEnvelope.checksum,
      save_envelope: restoredEnvelope,
      season_id: summary.season_id,
      season_number: summary.season_number,
      phase: summary.phase,
      matchday: summary.current_matchday,
      updated_at: at
    }),
    checks: Object.freeze({
      current_checksum_matched: !expectedChecksum || currentEnvelope.checksum === expectedChecksum,
      backup_loads: true,
      world_identity_preserved: currentWorld.world_id === restoredWorld.world_id,
      club_identity_preserved: currentWorld.human_club_id === restoredWorld.human_club_id
    }),
    accepted: true
  });
}

export function buildResetPlan(currentSave, resetSave, options = {}) {
  return buildRestorePlan(currentSave, {
    backup_id: options.sourceBackupId || 'operator-reset-source',
    manager_id: currentSave.manager_id,
    save_envelope: envelopeObject(resetSave?.save_envelope ?? resetSave?.saved_world ?? resetSave)
  }, { ...options, mode: 'reset' });
}

export function selectRollbackBackup(backups, currentChecksum) {
  const candidates = [...(backups || [])]
    .filter((row) => row?.save_envelope && row.save_checksum !== currentChecksum)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || String(b.backup_id || b.id).localeCompare(String(a.backup_id || a.id)));
  if (!candidates.length) throw new Error('No earlier backup is available for rollback');
  return candidates[0];
}

export function buildMonitoringAlert(inspection, { alertId, createdAt = inspection.checked_at, source = 'scheduled_monitor' } = {}) {
  if (inspection.severity === 'healthy') return null;
  return Object.freeze({
    alert_id: text(alertId) || `${inspection.world_id}:${inspection.severity}:${Date.parse(iso(createdAt))}`,
    world_id: inspection.world_id,
    manager_id: inspection.manager_id,
    club_id: inspection.club_id,
    severity: inspection.severity,
    source,
    status: 'open',
    title: inspection.severity === 'critical' ? 'Persistent world save failed validation' : 'Persistent world needs operational attention',
    details: {
      failed_checks: Object.entries(inspection.checks).filter(([, value]) => !value).map(([key]) => key),
      errors: [...inspection.errors],
      metrics: inspection.metrics
    },
    created_at: iso(createdAt)
  });
}
