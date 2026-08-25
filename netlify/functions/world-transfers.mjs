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
  return { user, manager, appointment };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const serviceAuth = {
      apiKey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {}),
      method: 'POST'
    };

    if (request.method === 'GET') {
      const register = await supabase('/rest/v1/rpc/get_world_transfer_register_for_user', {
        ...serviceAuth,
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_limit: 100
        })
      });
      return json({
        world_id: current.appointment.world_id,
        club_id: current.appointment.club_id,
        transfers: Array.isArray(register) ? register : []
      });
    }

    if (request.method === 'POST') {
      const payload = await request.json().catch(() => ({}));
      if (payload.action !== 'report') return json({ error: 'Unsupported action' }, 400);
      const dealId = String(payload.deal_id || '').trim();
      const reason = String(payload.reason || '').trim();
      const note = String(payload.note || '').trim();
      if (!dealId || !reason) return json({ error: 'Deal and report reason are required' }, 400);
      const result = await supabase('/rest/v1/rpc/submit_transfer_integrity_report_for_user', {
        ...serviceAuth,
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_deal_id: dealId,
          p_reason: reason,
          p_note: note || null
        })
      });
      return json(result || { message: 'Transfer reported privately for competitive-integrity review.' }, 201);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    const message = String(error?.message || 'World transfers request failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /already reported|Only publicly accepted|Invalid|appointment|read model|world/i.test(message) ? 409
      : 503;
    return json({ error: message }, status);
  }
};
