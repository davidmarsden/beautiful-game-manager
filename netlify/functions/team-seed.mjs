const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => { const value = request.headers.get('authorization') || ''; return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''; };
async function rest(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Supabase returned ${response.status}`);
  return body;
}
export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const url = new URL(request.url);
    const clubId = String(url.searchParams.get('club_id') || '').trim();
    const fixtureId = String(url.searchParams.get('fixture_id') || '').trim();
    if (!clubId) return json({ error: 'club_id is required' }, 400);
    const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(clubId)}&status=eq.active&select=id&limit=1`, token);
    if (!appointments[0]) return json({ error: 'You are not appointed to this club' }, 403);

    if (fixtureId) {
      const current = await rest(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(fixtureId)}&club_id=eq.${encodeURIComponent(clubId)}&select=*&limit=1`, token).catch(() => []);
      if (current[0]) return json({ source: 'current_submission', submission: current[0] });
    }

    const fixtureFilter = fixtureId ? `&fixture_id=neq.${encodeURIComponent(fixtureId)}` : '';
    const previous = await rest(`/rest/v1/manager_submissions?club_id=eq.${encodeURIComponent(clubId)}${fixtureFilter}&status=in.(submitted,locked)&select=*&order=updated_at.desc&limit=1`, token).catch(() => []);
    return json({ source: previous[0] ? 'last_team' : 'none', submission: previous[0] || null });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};