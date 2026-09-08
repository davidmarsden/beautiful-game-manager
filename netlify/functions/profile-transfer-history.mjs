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

function cashForPlayer(deal, playerLeg) {
  const cashLegs = (deal.legs || []).filter((leg) => leg.leg_type === 'cash');
  const reverse = cashLegs.find((leg) => leg.from_club_id === playerLeg.to_club_id && leg.to_club_id === playerLeg.from_club_id);
  return Number(reverse?.amount ?? 0) || 0;
}

function dealEvents(register = []) {
  return register.flatMap((deal) => {
    if (deal.status !== 'completed') return [];
    const playerLegs = (deal.legs || []).filter((leg) => leg.leg_type === 'permanent_transfer' && leg.player_id);
    return playerLegs.map((leg) => ({
      event_id: `${deal.deal_id}:${leg.sequence_no}`,
      source: 'transfer_deal',
      transfer_type: playerLegs.length > 1 ? 'exchange' : 'permanent',
      player_id: leg.player_id,
      player_name: leg.player_name || leg.player_id,
      from_club_id: leg.from_club_id,
      from_club_name: leg.from_club_name || leg.from_club_id,
      to_club_id: leg.to_club_id,
      to_club_name: leg.to_club_name || leg.to_club_id,
      fee: cashForPlayer(deal, leg),
      package_player_count: playerLegs.length,
      contract_years: leg.contract_years ?? null,
      completed_at: deal.terminal_at || deal.binding_at || deal.agreed_at
    }));
  });
}

function acquisitionEvents(rows = [], clubNames = {}) {
  return rows.filter((row) => row.status === 'completed').map((row) => ({
    event_id: `acquisition:${row.id}`,
    source: 'player_acquisition',
    transfer_type: row.acquisition_type === 'external' ? 'external' : 'free_agent',
    player_id: row.player_id,
    player_name: row.player_name || row.player_id,
    from_club_id: null,
    from_club_name: row.acquisition_type === 'external' ? 'External market' : 'Free agent',
    to_club_id: row.club_id,
    to_club_name: clubNames[row.club_id] || row.club_id,
    fee: 0,
    package_player_count: 1,
    contract_years: row.contract_years ?? null,
    completed_at: row.terminal_at || row.updated_at || row.created_at
  }));
}

function matches(event, playerId, clubId) {
  if (playerId && event.player_id !== playerId) return false;
  if (clubId && event.from_club_id !== clubId && event.to_club_id !== clubId) return false;
  return true;
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
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
    };
    const register = await supabase('/rest/v1/rpc/get_world_transfer_register_for_user', {
      ...serviceAuth,
      method: 'POST',
      body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id, p_limit: 200 })
    });
    const acquisitions = await supabase(`/rest/v1/player_acquisitions?world_id=eq.${encodeURIComponent(current.appointment.world_id)}&status=eq.completed&select=id,acquisition_type,player_id,player_name,club_id,contract_years,status,created_at,updated_at,terminal_at&order=terminal_at.desc.nullslast&limit=500`, {
      ...serviceAuth,
      method: 'GET'
    });

    const clubNames = {};
    for (const event of dealEvents(Array.isArray(register) ? register : [])) {
      if (event.from_club_id && event.from_club_name) clubNames[event.from_club_id] = event.from_club_name;
      if (event.to_club_id && event.to_club_name) clubNames[event.to_club_id] = event.to_club_name;
    }
    const events = [
      ...dealEvents(Array.isArray(register) ? register : []),
      ...acquisitionEvents(Array.isArray(acquisitions) ? acquisitions : [], clubNames)
    ]
      .filter((event) => matches(event, playerId, clubId))
      .sort((a, b) => (new Date(b.completed_at).getTime() || 0) - (new Date(a.completed_at).getTime() || 0));

    return json({
      world_id: current.appointment.world_id,
      player_id: playerId || null,
      club_id: clubId || null,
      events
    });
  } catch (error) {
    const message = String(error?.message || 'Could not load profile transfer history');
    const status = /Session|Authentication/.test(message) ? 401 : /appointment|read model|world/i.test(message) ? 409 : 503;
    return json({ error: message }, status);
  }
};

export { dealEvents, acquisitionEvents, matches };