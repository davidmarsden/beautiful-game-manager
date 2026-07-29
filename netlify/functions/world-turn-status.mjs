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
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
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
  const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id&limit=1`);
  const appointment = appointments[0];
  if (!appointment) throw new Error('Administrator has no active world appointment');
  return appointment;
}

function newestCompleted(runs) {
  return [...runs].filter((run) => run.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0] || null;
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Turn status is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const appointment = await adminIdentity(token);
    const worldId = appointment.world_id;
    const worlds = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=world_id,season_id,matchday,save_checksum,turn_status,next_turn_at,updated_at&limit=1`);
    const world = worlds[0];
    if (!world) return json({ error: `Canonical world ${worldId} does not exist` }, 404);

    const runs = await service(`/rest/v1/world_turn_runs?world_id=eq.${encodeURIComponent(worldId)}&select=id,season_id,matchday,previous_checksum,next_checksum,status,scheduled_for,completed_at,error_message&order=scheduled_for.desc&limit=8`);
    const processing = runs.find((run) => run.status === 'processing') || null;
    const completed = newestCompleted(runs);
    const latest = processing || completed;

    const operations = await service(`/rest/v1/world_operation_events?world_id=eq.${encodeURIComponent(worldId)}&operation_type=eq.advance&select=operation_id,status,previous_checksum,replacement_checksum,details,created_at&order=created_at.desc&limit=3`);
    const operation = operations[0] || null;
    const diagnostics = operation?.details?.diagnostics || operation?.details?.scheduler_result?.diagnostics || null;

    let state = 'idle';
    if (processing || world.turn_status === 'locking') state = 'processing';
    else if (world.turn_status === 'failed') state = 'failed';
    else if (latest?.status === 'complete' && latest.next_checksum === world.save_checksum) state = 'complete';

    return json({
      state,
      world_id: world.world_id,
      season_id: world.season_id,
      matchday: world.matchday,
      checksum: world.save_checksum,
      turn_status: world.turn_status,
      next_turn_at: world.next_turn_at,
      run: latest,
      operation_id: operation?.operation_id || null,
      operation_status: operation?.status || null,
      diagnostics
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : 503;
    return json({ error: error.message }, status);
  }
};
