import scheduledWorldTurn from './scheduled-world-turn.mjs';

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

function serviceHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
    'content-type': 'application/json'
  };
}

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { ...serviceHeaders(), prefer: options.prefer || 'return=representation', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function adminIdentity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,is_admin&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  if (!profileResponse.ok) throw new Error('Could not resolve administrator profile');
  const manager = (await profileResponse.json())[0];
  if (!manager?.is_admin) throw new Error('Administrator access required');
  const appointmentResponse = await fetch(`${SUPABASE_URL}/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  if (!appointmentResponse.ok) throw new Error('Could not resolve administrator appointment');
  const appointment = (await appointmentResponse.json())[0];
  if (!appointment) throw new Error('Administrator has no active world appointment');
  return { manager, appointment };
}

async function repairedFailureLineage(worldId, checksum) {
  const repairs = await service(`/rest/v1/world_operation_events?world_id=eq.${encodeURIComponent(worldId)}&replacement_checksum=eq.${encodeURIComponent(checksum)}&operation_type=eq.registration_repair&status=eq.accepted&select=operation_id,details,created_at&order=created_at.desc&limit=1`);
  const repair = repairs[0] || null;
  if (!repair) return null;

  const explicit = repair.details?.recovery_lineage || null;
  if (explicit?.reopened_for_retry && explicit?.superseded_failed_run_id) {
    const failedRuns = await service(`/rest/v1/world_turn_runs?id=eq.${encodeURIComponent(explicit.superseded_failed_run_id)}&world_id=eq.${encodeURIComponent(worldId)}&status=eq.failed&select=id,previous_checksum,completed_at,error_message&limit=1`);
    const failedRun = failedRuns[0] || null;
    if (!failedRun) throw new Error('Repaired checkpoint recovery lineage does not resolve to a failed turn record; manual recovery is required');
    if (explicit.failed_checksum && failedRun.previous_checksum !== explicit.failed_checksum) throw new Error('Repaired checkpoint recovery lineage checksum does not match its failed turn record; manual recovery is required');
    return { repair_operation_id: repair.operation_id, failed_run: failedRun, lineage: explicit, legacy_inferred: false };
  }

  const legacyFailedChecksum = repair.details?.before?.turn_status === 'failed' ? repair.details?.before?.checksum : null;
  if (!legacyFailedChecksum) return null;
  const failedRuns = await service(`/rest/v1/world_turn_runs?world_id=eq.${encodeURIComponent(worldId)}&previous_checksum=eq.${encodeURIComponent(legacyFailedChecksum)}&status=eq.failed&select=id,previous_checksum,completed_at,error_message&order=completed_at.desc&limit=1`);
  const failedRun = failedRuns[0] || null;
  if (!failedRun) throw new Error('Legacy repaired checkpoint does not resolve to its superseded failed turn record; manual recovery is required');
  return {
    repair_operation_id: repair.operation_id,
    failed_run: failedRun,
    legacy_inferred: true,
    lineage: {
      reopened_for_retry: true,
      superseded_failed_run_id: failedRun.id,
      failed_checksum: failedRun.previous_checksum,
      failure_completed_at: failedRun.completed_at || null,
      failure_error: failedRun.error_message || null
    }
  };
}

function compact(result, before, after, operationId, recovery) {
  return {
    accepted: result.status === 'complete',
    operation_id: operationId,
    operation: recovery?.mode || 'run_due_turn_now',
    recovery_of_run_id: recovery?.failedRun?.id || null,
    repair_operation_id: recovery?.repairOperationId || null,
    recovery_lineage_inferred: recovery?.legacyInferred || false,
    world_id: result.world_id,
    season_id: result.season_id || before.season_id,
    matchday_advanced: result.matchday || before.matchday,
    next_matchday: after?.matchday ?? null,
    previous_checksum: before.save_checksum,
    replacement_checksum: after?.save_checksum || result.checksum || null,
    next_turn_at: result.next_turn_at || after?.next_turn_at || null,
    status: result.status,
    reason: result.reason || null,
    error: result.error || null,
    diagnostics: result.diagnostics || null
  };
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Scheduled world processing is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await adminIdentity(token);
    const worldId = current.appointment.world_id;
    const now = new Date().toISOString();
    const rows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*`);
    const before = rows[0];
    if (!before) return json({ error: `Canonical world ${worldId} does not exist` }, 404);

    const failedStatus = before.turn_status === 'failed';
    if (before.turn_status !== 'open' && !failedStatus) return json({ error: `Canonical world is ${before.turn_status}; duplicate or replayed execution rejected` }, 409);

    let recovery = null;
    if (failedStatus) {
      const failedRuns = await service(`/rest/v1/world_turn_runs?world_id=eq.${encodeURIComponent(worldId)}&previous_checksum=eq.${encodeURIComponent(before.save_checksum)}&status=eq.failed&select=id,previous_checksum,completed_at,error_message&order=completed_at.desc&limit=1`);
      const failedRun = failedRuns[0] || null;
      if (failedRun) {
        recovery = { mode: 'retry_failed_turn', failedRun, repairOperationId: null, legacyInferred: false };
      } else {
        const repaired = await repairedFailureLineage(worldId, before.save_checksum);
        if (!repaired) return json({ error: 'Failed world has no matching failed turn or repaired-checkpoint lineage; manual recovery is required' }, 409);
        recovery = { mode: 'retry_repaired_failed_turn', failedRun: repaired.failed_run, repairOperationId: repaired.repair_operation_id, legacyInferred: repaired.legacy_inferred };
      }
    } else {
      const repaired = await repairedFailureLineage(worldId, before.save_checksum);
      if (repaired) recovery = { mode: 'retry_repaired_failed_turn', failedRun: repaired.failed_run, repairOperationId: repaired.repair_operation_id, legacyInferred: repaired.legacy_inferred };
    }

    if (!recovery && (!before.next_turn_at || new Date(before.next_turn_at) > new Date(now))) return json({ error: 'Canonical world is not due yet' }, 409);

    const operationId = recovery
      ? `scheduled-turn-recovery:${worldId}:${recovery.failedRun.id}:${before.save_checksum}`
      : `scheduled-turn:${worldId}:${before.season_id}:${before.matchday}:${before.save_checksum}`;
    const existing = await service(`/rest/v1/world_operation_events?operation_id=eq.${encodeURIComponent(operationId)}&select=operation_id,status&limit=1`);
    if (existing[0]) return json({ error: 'This canonical turn recovery has already been executed or recorded' }, 409);

    if (failedStatus) {
      const reopened = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&save_checksum=eq.${encodeURIComponent(before.save_checksum)}&turn_status=eq.failed`, {
        method: 'PATCH',
        body: JSON.stringify({ turn_status: 'open', updated_at: now }),
        headers: { prefer: 'return=representation' }
      });
      if (reopened.length !== 1) return json({ error: 'Failed world changed before retry; replay rejected' }, 409);
    }

    const schedulerResponse = await scheduledWorldTurn();
    const schedulerBody = await schedulerResponse.json();
    const result = schedulerBody.results?.find((entry) => entry.world_id === worldId);
    if (!result) throw new Error('Production scheduler did not return the administrator world');

    const afterRows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*`);
    const after = afterRows[0] || null;
    const details = compact(result, before, after, operationId, recovery);
    await service('/rest/v1/world_operation_events', {
      method: 'POST',
      body: JSON.stringify({
        operation_id: operationId,
        operation_type: 'advance',
        world_id: worldId,
        manager_id: null,
        club_id: null,
        previous_checksum: before.save_checksum,
        replacement_checksum: after?.save_checksum || result.checksum || null,
        status: result.status === 'complete' ? 'accepted' : 'rejected',
        details: {
          action: recovery?.mode || 'run_due_turn_now',
          production_scheduler_version: schedulerBody.version,
          recovery_of_run_id: recovery?.failedRun?.id || null,
          repair_operation_id: recovery?.repairOperationId || null,
          recovery_failed_checksum: recovery?.failedRun?.previous_checksum || null,
          recovery_lineage_inferred: recovery?.legacyInferred || false,
          before: { season_id: before.season_id, matchday: before.matchday, checksum: before.save_checksum, next_turn_at: before.next_turn_at, turn_status: before.turn_status },
          after: after ? { season_id: after.season_id, matchday: after.matchday, checksum: after.save_checksum, next_turn_at: after.next_turn_at, turn_status: after.turn_status } : null,
          scheduler_result: result
        },
        requested_by: current.manager.id,
        created_at: now
      })
    });

    return json(details, result.status === 'complete' ? 200 : 409);
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : /already|duplicate|replay|not due|is locking|manual recovery|changed before retry|recovery lineage|Legacy repaired checkpoint/.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};