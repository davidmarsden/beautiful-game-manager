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

async function requestSupabase(path, { apiKey, bearer, ...options } = {}) {
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

const serviceSupabase = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
});

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  return response.json();
}

async function activeWorld(userId) {
  const profiles = await serviceSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`);
  if (!profiles[0]) throw new Error('Manager profile has not been created yet');
  const appointments = await serviceSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(profiles[0].id)}&status=eq.active&select=world_id&limit=1`);
  if (!appointments[0]) throw new Error('No active club appointment');
  return appointments[0].world_id;
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await identity(token);
    const worldId = await activeWorld(user.id);
    const url = new URL(request.url);
    const target = String(url.searchParams.get('manager_id') || '').trim() || null;

    const result = await serviceSupabase('/rest/v1/rpc/get_manager_participation_for_user', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: user.id,
        p_world_id: worldId,
        p_target_manager_id: target
      })
    });
    return json(result);
  } catch (error) {
    const message = String(error?.message || 'Could not load manager participation');
    const status = /Session|Authentication/.test(message) ? 401
      : /appointment|profile/i.test(message) ? 409
      : /not active in this world/i.test(message) ? 404
      : 503;
    return json({ error: message }, status);
  }
};
