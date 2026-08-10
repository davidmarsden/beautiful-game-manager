const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => { const value = request.headers.get('authorization') || ''; return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''; };
const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, bearer: bearerCredential, ...options } = {}) {
  const headers = { apikey: apiKey, accept: 'application/json', ...(options.headers || {}) };
  if (bearerCredential) headers.authorization = `Bearer ${bearerCredential}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const userRest = (path, token, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_ANON_KEY,
  bearer: token
});
const serverRest = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
});

function normalizeTurnSubmission(row) {
  if (!row) return null;
  const instruction = row.instruction && typeof row.instruction === 'object' ? row.instruction : {};
  return {
    ...row,
    ...instruction,
    instruction,
    fixture_id: instruction.fixture_id || null,
    formation: instruction.formation || null,
    starting_xi: Array.isArray(instruction.starting_xi) ? instruction.starting_xi : [],
    bench: Array.isArray(instruction.bench) ? instruction.bench : [],
    captain_id: instruction.captain_id || null,
    set_piece_takers: instruction.set_piece_takers || {},
    tactics: instruction.tactics || {}
  };
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const profiles = await userRest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);

    const url = new URL(request.url);
    const clubId = String(url.searchParams.get('club_id') || '').trim();
    const fixtureId = String(url.searchParams.get('fixture_id') || '').trim();
    if (!clubId) return json({ error: 'club_id is required' }, 400);

    const appointments = await userRest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(clubId)}&status=eq.active&select=id,world_id,club_id,manager_id&limit=1`, token);
    const appointment = appointments[0];
    if (!appointment) return json({ error: 'You are not appointed to this club' }, 403);

    const rows = await serverRest(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(appointment.world_id)}&manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(clubId)}&status=in.(submitted,locked,consumed)&select=id,world_id,season_id,matchday,manager_id,club_id,status,submitted_at,instruction&order=matchday.desc,submitted_at.desc&limit=12`);
    const submissions = (rows || []).map(normalizeTurnSubmission);
    const current = fixtureId
      ? submissions.find((row) => String(row.fixture_id || '') === fixtureId && ['submitted', 'locked'].includes(String(row.status))) || null
      : null;
    const history = submissions
      .filter((row) => !fixtureId || String(row.fixture_id || '') !== fixtureId)
      .slice(0, 10);
    const submission = current || history[0] || null;
    const source = current ? 'current_submission' : submission ? 'last_team' : 'none';

    return json({ source, submission, history });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};