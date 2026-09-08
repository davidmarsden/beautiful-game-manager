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
const isJwt = (value) => String(value || '').split('.').length === 3;

async function supabase(path, { apiKey, bearer, ...options } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, {
    apiKey: SUPABASE_ANON_KEY,
    bearer: token
  });
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, {
    apiKey: SUPABASE_ANON_KEY,
    bearer: token
  });
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, appointment };
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const url = new URL(request.url);
    const playerId = String(url.searchParams.get('player_id') || '').trim();
    const clubId = String(url.searchParams.get('club_id') || '').trim();
    if (!playerId && !clubId) return json({ error: 'player_id or club_id is required' }, 400);

    const serviceAuth = {
      apiKey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {}),
      method: 'POST'
    };
    const events = await supabase('/rest/v1/rpc/get_profile_transfer_history_for_user', {
      ...serviceAuth,
      body: JSON.stringify({
        p_user_id: current.user.id,
        p_world_id: current.appointment.world_id,
        p_player_id: playerId || null,
        p_club_id: clubId || null
      })
    });

    return json({
      world_id: current.appointment.world_id,
      player_id: playerId || null,
      club_id: clubId || null,
      events: Array.isArray(events) ? events : []
    });
  } catch (error) {
    const message = String(error?.message || 'Could not load profile transfer history');
    const status = /Session|Authentication/.test(message) ? 401 : /appointment|read model|world/i.test(message) ? 409 : 503;
    return json({ error: message }, status);
  }
};
