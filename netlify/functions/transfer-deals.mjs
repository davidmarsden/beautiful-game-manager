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

function requestKey(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
        body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
      });
      return json(market || {
        world_id: current.appointment.world_id,
        club_id: current.appointment.club_id,
        listings: [],
        outgoing_offers: [],
        incoming_offers: []
      });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const clientRequestId = String(body.client_request_id || body.clientRequestId || '').trim() || randomUUID();

    if (['list', 'withdraw'].includes(action)) {
      const playerId = String(body.player_id || body.playerId || '').trim();
      const askingFee = Math.max(0, Number(body.asking_fee ?? body.askingFee ?? 0) || 0);
      if (!playerId) return json({ error: 'Player is required' }, 400);
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        player_id: playerId,
        asking_fee: askingFee,
        client_request_id: clientRequestId
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
      return json({ accepted: true, action, listing,
        message: action === 'withdraw' ? 'Transfer listing withdrawn immediately.' : 'Player listed for transfer immediately.' });
    }

    if (['offer', 'withdraw_offer'].includes(action)) {
      const playerId = String(body.player_id || body.playerId || '').trim();
      const sellerClubId = String(body.seller_club_id || body.sellerClubId || '').trim();
      const fee = Math.max(0, Number(body.fee || 0) || 0);
      const contractYears = Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3));
      const dealId = String(body.deal_id || body.dealId || '').trim() || null;
      if (action === 'offer' && (!playerId || !sellerClubId)) return json({ error: 'Player and selling club are required' }, 400);
      if (action === 'withdraw_offer' && !dealId) return json({ error: 'Deal is required' }, 400);
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        player_id: playerId,
        seller_club_id: sellerClubId,
        fee,
        contract_years: contractYears,
        deal_id: dealId,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/set_manager_transfer_offer_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_action: action,
          p_player_id: playerId || null,
          p_seller_club_id: sellerClubId || null,
          p_fee: fee,
          p_contract_years: contractYears,
          p_deal_id: dealId,
          p_request_key: key
        })
      });
      return json({ accepted: true, action, deal: result,
        message: action === 'withdraw_offer' ? 'Transfer offer withdrawn immediately.' : 'Transfer offer sent immediately.' });
    }

    return json({ error: 'Unsupported transfer action' }, 400);
  } catch (error) {
    const message = String(error?.message || 'Transfer market request failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /required|owned|listing action|offer action|active transfer listing|read model|canonical world|appointment|selling club|offer|deal/i.test(message) ? 409
        : 503;
    return json({ error: message }, status);
  }
};
