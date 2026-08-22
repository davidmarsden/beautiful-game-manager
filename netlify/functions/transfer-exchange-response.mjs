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
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  const user = await response.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await userSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

const requestKey = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

function normalizeCounterLegs(rawLegs) {
  if (!Array.isArray(rawLegs) || !rawLegs.length) throw new Error('A counter-offer requires the complete replacement leg set');
  const seen = new Set();
  return rawLegs.map((raw) => {
    const legType = String(raw?.leg_type || raw?.legType || '').trim().toLowerCase();
    const fromClubId = String(raw?.from_club_id || raw?.fromClubId || '').trim();
    const toClubId = String(raw?.to_club_id || raw?.toClubId || '').trim();
    if (!['permanent_transfer', 'cash'].includes(legType)) throw new Error('Exchange counters support permanent player and cash legs only');
    if (!fromClubId || !toClubId || fromClubId === toClubId) throw new Error('Every exchange leg requires different source and destination clubs');
    if (legType === 'cash') {
      const amount = Number(raw?.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Cash legs must be greater than zero');
      return { leg_type: 'cash', from_club_id: fromClubId, to_club_id: toClubId, amount };
    }
    const playerId = String(raw?.player_id || raw?.playerId || '').trim();
    if (!playerId) throw new Error('Every permanent-transfer leg requires a player');
    if (seen.has(playerId)) throw new Error('The same player cannot appear twice in one exchange counter');
    seen.add(playerId);
    const contractYears = Math.max(1, Math.min(5, Number(raw?.contract_years ?? raw?.contractYears ?? 3) || 3));
    return {
      leg_type: 'permanent_transfer',
      from_club_id: fromClubId,
      to_club_id: toClubId,
      player_id: playerId,
      contract_years: contractYears
    };
  });
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    if (!['accept', 'decline', 'counter'].includes(action)) return json({ error: 'Response action must be accept, decline or counter' }, 400);
    const dealId = String(body.deal_id || body.dealId || '').trim();
    const revisionNo = Number(body.revision_no ?? body.revisionNo);
    if (!dealId) return json({ error: 'Deal is required' }, 400);
    if (!Number.isInteger(revisionNo) || revisionNo < 1) return json({ error: 'Exact deal revision is required' }, 400);
    const legs = action === 'counter' ? normalizeCounterLegs(body.legs) : null;
    const clientRequestId = String(body.client_request_id || body.clientRequestId || '').trim() || randomUUID();
    const key = requestKey({
      user_id: current.user.id,
      world_id: current.appointment.world_id,
      deal_id: dealId,
      revision_no: revisionNo,
      action,
      legs,
      client_request_id: clientRequestId
    });

    const result = await serverSupabase('/rest/v1/rpc/respond_manager_transfer_exchange_deal_for_user', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: current.user.id,
        p_world_id: current.appointment.world_id,
        p_deal_id: dealId,
        p_revision_no: revisionNo,
        p_action: action,
        p_legs: legs,
        p_request_key: key
      })
    });

    return json({
      accepted: true,
      action,
      deal: result,
      message: action === 'accept'
        ? 'Exchange terms agreed. The normal mistake-grace period now applies before atomic settlement.'
        : action === 'decline'
          ? 'Exchange offer declined.'
          : 'Exchange counter-offer sent as a complete new revision.'
    });
  } catch (error) {
    const message = String(error?.message || 'Exchange response failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /required|revision|participant|exchange|counter|offer|deal|owned|stale|already responded|read model/i.test(message) ? 409
        : 503;
    return json({ error: message }, status);
  }
};
