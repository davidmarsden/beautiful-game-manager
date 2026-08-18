import { createHash, randomUUID } from 'node:crypto';

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
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const userSupabase = (path, token, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_ANON_KEY,
  bearer: token
});
const serverSupabase = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
});

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await userSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

function requestKey({ userId, worldId, action, playerId, askingFee, clientRequestId }) {
  return createHash('sha256').update(JSON.stringify({
    user_id: userId,
    world_id: worldId,
    action,
    player_id: playerId,
    asking_fee: askingFee,
    client_request_id: clientRequestId
  })).digest('hex');
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);

    if (request.method === 'GET') {
      const market = await serverSupabase('/rest/v1/rpc/get_manager_transfer_market_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id
        })
      });
      return json(market || { world_id: current.appointment.world_id, club_id: current.appointment.club_id, listings: [] });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const playerId = String(body.player_id || body.playerId || '').trim();
    const askingFee = Math.max(0, Number(body.asking_fee ?? body.askingFee ?? 0) || 0);
    const clientRequestId = String(body.client_request_id || body.clientRequestId || '').trim() || randomUUID();

    if (!['list', 'withdraw'].includes(action)) return json({ error: 'Action must be list or withdraw' }, 400);
    if (!playerId) return json({ error: 'Player is required' }, 400);

    const key = requestKey({
      userId: current.user.id,
      worldId: current.appointment.world_id,
      action,
      playerId,
      askingFee,
      clientRequestId
    });

    const rows = await serverSupabase('/rest/v1/rpc/set_manager_transfer_listing_for_user', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: current.user.id,
        p_world_id: current.appointment.world_id,
        p_player_id: playerId,
        p_action: action,
        p_asking_fee: askingFee,
        p_request_key: key
      })
    });
    const listing = Array.isArray(rows) ? rows[0] : rows;
    return json({
      accepted: true,
      action,
      listing,
      message: action === 'withdraw'
        ? 'Transfer listing withdrawn immediately.'
        : 'Player listed for transfer immediately.'
    });
  } catch (error) {
    const message = String(error?.message || 'Transfer market request failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /required|owned|listing action|active transfer listing|read model|canonical world|appointment/i.test(message) ? 409
        : 503;
    return json({ error: message }, status);
  }
};
