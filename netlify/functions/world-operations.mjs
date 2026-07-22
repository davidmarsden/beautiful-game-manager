import {
  buildMonitoringAlert,
  buildResetPlan,
  buildRestorePlan,
  buildWorldBackupRecord,
  inspectPersistentSave,
  selectRollbackBackup
} from '../../src/world/worldOperations.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function requestSupabase(path, { token, apiKey, ...options } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
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

function userSupabase(path, token, options = {}) {
  return requestSupabase(path, { ...options, token, apiKey: SUPABASE_ANON_KEY });
}

function adminSupabase(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for world operations');
  return requestSupabase(path, {
    ...options,
    token: SUPABASE_SERVICE_ROLE_KEY,
    apiKey: SUPABASE_SERVICE_ROLE_KEY
  });
}

async function adminIdentity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,is_admin&limit=1`, token);
  const manager = profiles[0];
  if (!manager?.is_admin) throw new Error('Administrator access required');
  return { user, manager };
}

async function readSave(worldId, managerId) {
  const rows = await adminSupabase(`/rest/v1/persistent_world_saves?world_id=eq.${encodeURIComponent(worldId)}&manager_id=eq.${encodeURIComponent(managerId)}&select=*&limit=1`);
  if (!rows[0]) throw new Error('Persistent world save not found');
  return rows[0];
}

async function backups(worldId, managerId, limit = 25) {
  return adminSupabase(`/rest/v1/persistent_world_backups?world_id=eq.${encodeURIComponent(worldId)}&manager_id=eq.${encodeURIComponent(managerId)}&select=*&order=created_at.desc&limit=${limit}`);
}

async function insert(table, row, conflict = null) {
  const suffix = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : '';
  const rows = await adminSupabase(`/rest/v1/${table}${suffix}`, {
    method: 'POST',
    body: JSON.stringify(row),
    headers: { prefer: conflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation' }
  });
  return rows[0] || row;
}

async function createBackup(stored, identity, source, reason) {
  const record = buildWorldBackupRecord(stored, {
    trigger: source,
    reason,
    createdBy: identity.manager.id
  });
  return insert('persistent_world_backups', record, 'backup_id');
}

export function conditionalReplacementPath(plan) {
  return `/rest/v1/persistent_world_saves?world_id=eq.${encodeURIComponent(plan.world_id)}&manager_id=eq.${encodeURIComponent(plan.manager_id)}&save_checksum=eq.${encodeURIComponent(plan.previous_checksum)}`;
}

async function writeReplacement(plan) {
  const rows = await adminSupabase(conditionalReplacementPath(plan), {
    method: 'PATCH',
    body: JSON.stringify(plan.replacement),
    headers: { prefer: 'return=representation' }
  });
  if (!rows[0]) throw new Error('Persistent world changed before replacement write');
  return rows[0];
}

async function logOperation(plan, identity, status = 'accepted', details = {}) {
  return insert('world_operation_events', {
    operation_id: plan.operation_id,
    operation_type: plan.operation_type,
    world_id: plan.world_id,
    manager_id: plan.manager_id,
    club_id: plan.club_id,
    source_backup_id: plan.source_backup_id,
    previous_checksum: plan.previous_checksum,
    replacement_checksum: plan.replacement_checksum,
    status,
    details,
    requested_by: identity.manager.id,
    created_at: plan.requested_at
  }, 'operation_id');
}

function requireTarget(body) {
  if (!body.world_id || !body.manager_id) throw new Error('world_id and manager_id are required');
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'World operations are not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const identity = await adminIdentity(token);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const worldId = url.searchParams.get('world_id');
      const managerId = url.searchParams.get('manager_id');
      if (!worldId || !managerId) return json({ error: 'world_id and manager_id are required' }, 400);
      const stored = await readSave(worldId, managerId);
      const rows = await backups(worldId, managerId);
      const inspection = inspectPersistentSave(stored, { latestBackup: rows[0] || null });
      const alerts = await adminSupabase(`/rest/v1/world_operation_alerts?world_id=eq.${encodeURIComponent(worldId)}&status=eq.open&select=*&order=created_at.desc&limit=20`);
      return json({ accepted: true, inspection, backups: rows.map(({ save_envelope, ...row }) => row), alerts });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));
    requireTarget(body);
    const stored = await readSave(body.world_id, body.manager_id);

    if (body.type === 'backup') {
      const backup = await createBackup(stored, identity, 'manual', body.reason || 'manual_backup');
      await insert('world_operation_events', {
        operation_id: `backup:${backup.backup_id}`,
        operation_type: 'backup', world_id: stored.world_id, manager_id: stored.manager_id, club_id: stored.club_id,
        source_backup_id: backup.backup_id, previous_checksum: stored.save_checksum, replacement_checksum: stored.save_checksum,
        status: 'accepted', details: { reason: backup.reason }, requested_by: identity.manager.id
      }, 'operation_id');
      return json({ accepted: true, command: 'backup', backup: { ...backup, save_envelope: undefined } });
    }

    if (body.type === 'monitor') {
      const rows = await backups(body.world_id, body.manager_id);
      const inspection = inspectPersistentSave(stored, { latestBackup: rows[0] || null });
      const alert = buildMonitoringAlert(inspection);
      if (alert) await insert('world_operation_alerts', alert, 'alert_id');
      return json({ accepted: inspection.severity !== 'critical', command: 'monitor', inspection, alert });
    }

    if (!body.expected_checksum) throw new Error('expected_checksum is required for destructive operations');
    let plan;
    if (body.type === 'restore') {
      const rows = await adminSupabase(`/rest/v1/persistent_world_backups?backup_id=eq.${encodeURIComponent(body.backup_id)}&select=*&limit=1`);
      if (!rows[0]) throw new Error('Backup not found');
      plan = buildRestorePlan(stored, rows[0], { expectedChecksum: body.expected_checksum, requestedBy: identity.manager.id });
    } else if (body.type === 'rollback') {
      const rows = await backups(body.world_id, body.manager_id, 100);
      const selected = selectRollbackBackup(rows, stored.save_checksum);
      plan = buildRestorePlan(stored, selected, { expectedChecksum: body.expected_checksum, requestedBy: identity.manager.id, mode: 'rollback' });
    } else if (body.type === 'reset') {
      if (!body.saved_world) throw new Error('reset requires a canonical saved_world envelope');
      plan = buildResetPlan(stored, body.saved_world, { expectedChecksum: body.expected_checksum, requestedBy: identity.manager.id });
    } else {
      throw new Error(`Unsupported world operation: ${body.type}`);
    }

    const safetySource = body.type === 'restore' ? 'pre_restore' : body.type === 'rollback' ? 'pre_rollback' : 'pre_reset';
    const safetyBackup = await createBackup(stored, identity, safetySource, `${body.type}_safety_backup`);
    const saved = await writeReplacement(plan);
    await logOperation(plan, identity, 'accepted', { safety_backup_id: safetyBackup.backup_id });
    return json({ accepted: true, command: body.type, plan: { ...plan, replacement: undefined }, save: { checksum: saved.save_checksum, updated_at: saved.updated_at }, safety_backup_id: safetyBackup.backup_id });
  } catch (error) {
    const status = /Session|Authentication|Administrator/.test(error.message) ? 401 : /required/.test(error.message) ? 400 : /not found|changed|different|match|backup|world|club|manager/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
