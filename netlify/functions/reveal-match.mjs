const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};
async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
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
    const fixtures = await service(`/rest/v1/fixtures?id=eq.${encodeURIComponent(fixtureId)}&status=eq.played&select=id,world_id,home_club_id,away_club_id&limit=1`);
    const fixture = fixtures[0];
    if (!fixture) return json({ error: 'Played fixture not found' }, 404);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&world_id=eq.${encodeURIComponent(fixture.world_id)}&status=eq.active&select=club_id`);
    if (!appointments.some((row) => [fixture.home_club_id, fixture.away_club_id].includes(row.club_id))) return json({ error: 'You do not have access to this fixture' }, 403);

    const now = new Date().toISOString();
    await service('/rest/v1/manager_match_views?on_conflict=manager_id,fixture_id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ manager_id: manager.id, fixture_id: fixtureId, revealed_at: now, reveal_method: method, replay_completed: method === 'replay_completed', updated_at: now })
    });
    return json({ fixture_id: fixtureId, revealed: true, reveal_method: method, revealed_at: now });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
