import {
  buildMonitoringAlert,
  buildWorldBackupRecord,
  inspectPersistentSave
} from '../../src/world/worldOperations.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BACKUP_INTERVAL_HOURS = Number(process.env.TBG_BACKUP_INTERVAL_HOURS || 24);
const STALE_SAVE_HOURS = Number(process.env.TBG_STALE_SAVE_HOURS || 72);

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase ${path} returned ${response.status}`);
  return body;
}

async function insert(table, row, conflict) {
  const suffix = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : '';
  return supabase(`/rest/v1/${table}${suffix}`, {
    method: 'POST',
    body: JSON.stringify(row),
    headers: { prefer: conflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation' }
  });
}

function ageHours(value, now) {
  return value ? Math.max(0, (new Date(now) - new Date(value)) / 3600000) : Infinity;
}

async function recordMonitor(stored, inspection, latestBackup, now, status = null, details = {}) {
  return insert('world_operation_events', {
    operation_id: `monitor:${stored.world_id}:${Date.parse(now)}`,
    operation_type: 'monitor',
    world_id: stored.world_id,
    manager_id: null,
    club_id: null,
    source_backup_id: latestBackup?.backup_id || null,
    previous_checksum: stored.save_checksum,
    replacement_checksum: stored.save_checksum,
    status: status || (inspection.severity === 'critical' ? 'failed' : 'accepted'),
    details: { severity: inspection.severity, checks: inspection.checks, metrics: inspection.metrics, ...details },
    requested_by: null,
    created_at: now
  }, 'operation_id');
}

export default async () => {
  const now = new Date().toISOString();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Scheduled maintenance is not configured' }), { status: 503 });
  }
  try {
    const saves = await supabase('/rest/v1/canonical_world_saves?select=*&order=updated_at.asc');
    const results = [];
    for (const stored of saves) {
      try {
        const backupRows = await supabase(`/rest/v1/persistent_world_backups?world_id=eq.${encodeURIComponent(stored.world_id)}&select=*&order=created_at.desc&limit=1`);
        let latestBackup = backupRows[0] || null;
        let backupCreated = null;

        const preflight = inspectPersistentSave(stored, {
          now,
          staleAfterHours: STALE_SAVE_HOURS,
          latestBackup,
          backupMaxAgeHours: BACKUP_INTERVAL_HOURS + 1
        });

        if (preflight.severity !== 'critical' && (!latestBackup || ageHours(latestBackup.created_at, now) >= BACKUP_INTERVAL_HOURS)) {
          const record = buildWorldBackupRecord(stored, {
            trigger: 'scheduled',
            reason: 'scheduled_retention_backup',
            createdAt: now
          });
          const inserted = await insert('persistent_world_backups', record, 'backup_id');
          backupCreated = inserted[0] || record;
          latestBackup = backupCreated;
        }

        const inspection = inspectPersistentSave(stored, {
          now,
          staleAfterHours: STALE_SAVE_HOURS,
          latestBackup,
          backupMaxAgeHours: BACKUP_INTERVAL_HOURS + 1
        });
        const alert = buildMonitoringAlert(inspection, { createdAt: now });
        if (alert) await insert('world_operation_alerts', alert, 'alert_id');
        await recordMonitor(stored, inspection, latestBackup, now);
        results.push({
          world_id: stored.world_id,
          severity: inspection.severity,
          backup_created: Boolean(backupCreated),
          backup_skipped_invalid: preflight.severity === 'critical',
          alert_created: Boolean(alert)
        });
      } catch (error) {
        const inspection = {
          world_id: stored.world_id,
          manager_id: null,
          club_id: null,
          checked_at: now,
          severity: 'critical',
          checks: {},
          metrics: {},
          errors: [error.message]
        };
        const alert = buildMonitoringAlert(inspection, { createdAt: now });
        if (alert) await insert('world_operation_alerts', alert, 'alert_id').catch(() => null);
        await recordMonitor(stored, inspection, null, now, 'failed', { error: error.message }).catch(() => null);
        results.push({ world_id: stored.world_id, severity: 'critical', backup_created: false, alert_created: Boolean(alert), error: error.message });
      }
    }
    return new Response(JSON.stringify({ accepted: results.every((row) => row.severity !== 'critical'), checked_at: now, worlds_checked: results.length, results }), {
      status: results.some((row) => row.severity === 'critical') ? 503 : 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, checked_at: now }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
};
