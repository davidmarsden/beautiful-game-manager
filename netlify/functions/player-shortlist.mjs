const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = (value) => String(value ?? '').trim();

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function supabase(path, { token = '', service = false, method = 'GET', body = null, headers = {} } = {}) {
  const apiKey = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const bearer = service && isJwt(SUPABASE_SERVICE_ROLE_KEY) ? SUPABASE_SERVICE_ROLE_KEY : token;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Supabase returned ${response.status}`);
  return payload;
}

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Session is invalid or expired');
  const user = await response.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, { token });
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id&limit=1`, { token });
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { managerId: manager.id, worldId: appointment.world_id };
}

async function listEntries(managerId, worldId) {
  const rows = await supabase(`/rest/v1/manager_player_shortlists?manager_id=eq.${encodeURIComponent(managerId)}&world_id=eq.${encodeURIComponent(worldId)}&select=player_id,snapshot,created_at&order=created_at.desc`, { service: true });
  return rows.map((row) => ({ ...(row.snapshot || {}), id: row.player_id, shortlisted_at: row.created_at }));
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { managerId, worldId } = await identity(token);

    if (request.method === 'GET') return json({ results: await listEntries(managerId, worldId) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await request.json().catch(() => ({}));
    const action = text(body.action).toLowerCase();
    const playerId = text(body.player_id || body.result?.id);
    if (!playerId) return json({ error: 'Player id is required' }, 400);

    if (action === 'remove') {
      await supabase(`/rest/v1/manager_player_shortlists?manager_id=eq.${encodeURIComponent(managerId)}&world_id=eq.${encodeURIComponent(worldId)}&player_id=eq.${encodeURIComponent(playerId)}`, { service: true, method: 'DELETE' });
      const results = await listEntries(managerId, worldId);
      return json({ shortlisted: false, results });
    }

    if (action !== 'add') return json({ error: 'Action must be add or remove' }, 400);
    const result = body.result && typeof body.result === 'object' ? body.result : {};
    const snapshot = {
      type: 'player',
      id: playerId,
      name: text(result.name || result.player?.display_name || playerId),
      secondary: text(result.secondary),
      player: result.player && typeof result.player === 'object' ? result.player : { tbg_player_id: playerId, player_id: playerId },
      club: result.club && typeof result.club === 'object' ? result.club : {}
    };
    await supabase('/rest/v1/manager_player_shortlists?on_conflict=manager_id,world_id,player_id', {
      service: true,
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{ manager_id: managerId, world_id: worldId, player_id: playerId, snapshot, updated_at: new Date().toISOString() }]
    });
    const results = await listEntries(managerId, worldId);
    return json({ shortlisted: true, results });
  } catch (error) {
    const message = String(error?.message || 'Shortlist request failed');
    const status = /Session|Authentication/.test(message) ? 401 : /appointment|profile/i.test(message) ? 409 : 503;
    return json({ error: message }, status);
  }
};
