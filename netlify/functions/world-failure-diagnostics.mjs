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

async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: serviceHeaders() });
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
  const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,is_admin&limit=1`);
  const manager = profiles[0];
  if (!manager?.is_admin) throw new Error('Administrator access required');
  const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`);
  const appointment = appointments[0];
  if (!appointment) throw new Error('Administrator has no active world appointment');
  return { manager, appointment };
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'World diagnostics are not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await adminIdentity(token);
    const worldId = current.appointment.world_id;
    const worlds = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=world_id,season_id,matchday,save_checksum,turn_status,next_turn_at,updated_at&limit=1`);
    const world = worlds[0];
    if (!world) return json({ error: `Canonical world ${worldId} does not exist` }, 404);
    if (world.turn_status !== 'failed') return json({ active: false, world_id: worldId, turn_status: world.turn_status });

    const runs = await service(`/rest/v1/world_turn_runs?world_id=eq.${encodeURIComponent(worldId)}&previous_checksum=eq.${encodeURIComponent(world.save_checksum)}&status=eq.failed&select=id,season_id,matchday,previous_checksum,scheduled_for,completed_at,error_message&order=completed_at.desc&limit=1`);
    const failedRun = runs[0] || null;
    const operations = await service(`/rest/v1/world_operation_events?world_id=eq.${encodeURIComponent(worldId)}&operation_type=eq.advance&status=eq.rejected&previous_checksum=eq.${encodeURIComponent(world.save_checksum)}&select=operation_id,details,created_at&order=created_at.desc&limit=1`);
    const operation = operations[0] || null;
    const schedulerDetails = operation?.details || {};
    const schedulerResult = schedulerDetails.scheduler_result || {};

    return json({
      active: true,
      world_id: worldId,
      season_id: world.season_id,
      matchday: world.matchday,
      checksum: world.save_checksum,
      failed_at: failedRun?.completed_at || operation?.created_at || world.updated_at,
      failed_run_id: failedRun?.id || schedulerDetails.failed_run_id || null,
      operation_id: operation?.operation_id || null,
      error: failedRun?.error_message || schedulerDetails.error || schedulerResult.error || 'The production turn failed without a recorded exception.',
      diagnostics: schedulerDetails.diagnostics || schedulerResult.diagnostics || null,
      can_retry: Boolean(failedRun),
      recovery: failedRun
        ? 'Retry reopens this exact failed checkpoint and reuses the production scheduler. The unchanged checksum prevents replay against a different world state.'
        : 'The failure is recorded, but no matching failed turn row exists. Automatic retry is blocked; manual recovery is required.'
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : 503;
    return json({ error: error.message }, status);
  }
};
