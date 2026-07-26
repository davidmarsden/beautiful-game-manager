import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};
async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function canonicalPlayedFixture(world, fixtureId) {
  for (const runtime of Object.values(world.matchday_cycle?.runtimes || {})) {
    const fixture = (runtime.fixtures || []).find((row) => String(row.fixture_id) === fixtureId);
    if (!fixture) continue;
    const result = (runtime.results || []).find((row) => String(row.fixture?.fixture_id) === fixtureId);
    if (result) return fixture;
  }
  return null;
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Match reveal is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const payload = await request.json().catch(() => ({}));
    const fixtureId = String(payload.fixture_id || '').trim();
    const method = payload.method === 'skip_to_full_time' ? 'skip_to_full_time' : 'replay_completed';
    if (!fixtureId) return json({ error: 'fixture_id is required' }, 400);

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id`);
    if (!appointments.length) return json({ error: 'Manager has no active world appointment' }, 403);

    for (const appointment of appointments) {
      const saves = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_envelope&limit=1`);
      if (!saves[0]?.save_envelope) continue;
      const world = loadPersistentWorld(JSON.stringify(saves[0].save_envelope));
      const fixture = canonicalPlayedFixture(world, fixtureId);
      if (!fixture) continue;
      return json({ fixture_id: fixtureId, revealed: true, reveal_method: method, revealed_at: new Date().toISOString() });
    }

    return json({ error: 'Played fixture not found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
