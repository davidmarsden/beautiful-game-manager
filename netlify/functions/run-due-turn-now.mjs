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

function compact(result, before, after, operationId, retrying) {
  return {
    accepted: result.status === 'complete',
    operation_id: operationId,
    operation: retrying ? 'retry_failed_turn' : 'run_due_turn_now',
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

    const retrying = before.turn_status === 'failed';
    if (before.turn_status !== 'open' && before.turn_status !== 'failed') return json({ error: `Canonical world is ${before.turn_status}; duplicate or replayed execution rejected` }, 409);
    if (!retrying && (!before.next_turn_at || new Date(before.next_turn_at) > new Date(now))) return json({ error: 'Canonical world is not due yet' }, 409);

    let retryRun = null;
    if (retrying) {
      const failedRuns = await service(`/rest/v1/world_turn_runs?world_id=eq.${encodeURIComponent(worldId)}&previous_checksum=eq.${encodeURIComponent(before.save_checksum)}&status=eq.failed&select=id,completed_at,error_message&order=completed_at.desc&limit=1`);
      retryRun = failedRuns[0] || null;
      if (!retryRun) return json({ error: 'Failed world has no matching failed turn record; manual recovery is required' }, 409);
    }

    const operationId = retrying
      ? `scheduled-turn-retry:${worldId}:${retryRun.id}:${before.save_checksum}`
      : `scheduled-turn:${worldId}:${before.season_id}:${before.matchday}:${before.save_checksum}`;
    const existing = await service(`/rest/v1/world_operation_events?operation_id=eq.${encodeURIComponent(operationId)}&select=operation_id,status&limit=1`);
    if (existing[0]) return json({ error: 'This canonical turn recovery has already been executed or recorded' }, 409);

    if (retrying) {
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
    const details = compact(result, before, after, operationId, retrying);
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
          action: retrying ? 'retry_failed_turn' : 'run_due_turn_now',
          production_scheduler_version: schedulerBody.version,
          recovery_of_run_id: retryRun?.id || null,
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
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : /already|duplicate|replay|not due|is locking|manual recovery|changed before retry/.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};