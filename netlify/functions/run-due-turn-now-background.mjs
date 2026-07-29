import runDueTurnNow from './run-due-turn-now.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    headers: { ...serviceHeaders(), ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function adminContext(token) {
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
  return { manager, appointment };
}

async function recoverStaleLockIfPresent(request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return;
  const token = bearerToken(request);
  if (!token) return;
  const current = await adminContext(token);
  const worlds = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(current.appointment.world_id)}&select=world_id,save_checksum,turn_status,updated_at&limit=1`);
  const world = worlds[0];
  if (!world || world.turn_status !== 'locking') return;

  await service('/rest/v1/rpc/recover_stale_canonical_turn_lock', {
    method: 'POST',
    body: JSON.stringify({
      p_world_id: world.world_id,
      p_expected_checksum: world.save_checksum,
      p_expected_updated_at: world.updated_at,
      p_requested_by: current.manager.id,
      p_now: new Date().toISOString(),
      p_lease: '00:20:00'
    })
  });
}

export default async (request) => {
  await recoverStaleLockIfPresent(request);
  return runDueTurnNow(request);
};
