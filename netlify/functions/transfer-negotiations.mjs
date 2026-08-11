import { createHash } from 'node:crypto';

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

function directoryIndexes(directory = {}) {
  return {
    clubs: new Map((directory.clubs || []).map((club) => [club.club_id, club])),
    players: new Map((directory.players || []).map((player) => [player.player_id, player]))
  };
}

function projectOffer(directory, row) {
  const payload = row.command_payload || {};
  const playerId = payload.playerId || payload.player_id;
  const { clubs, players } = directoryIndexes(directory);
  return {
    proposal_id: row.id,
    player_id: playerId,
    player_name: players.get(playerId)?.player_name || playerId || 'Unknown player',
    buyer_club_id: row.club_id,
    buyer_club_name: clubs.get(row.club_id)?.club_name || row.club_id || 'Unknown club',
    seller_club_id: payload.otherClubId || payload.other_club_id,
    fee: Number(payload.fee || 0),
    contract_years: Number(payload.contractYears || payload.contract_years || 3),
    submitted_at: row.submitted_at,
    negotiation_state: row.negotiation_state || 'awaiting_response'
  };
}

function stableResponseKey({ worldId, managerId, proposalId, response }) {
  return createHash('sha256').update(JSON.stringify({ world_id: worldId, manager_id: managerId, proposal_id: proposalId, response })).digest('hex');
}

async function readTurnState(token, worldId) {
  const rows = await userSupabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=turn_status&limit=1`, token);
  return rows[0] || null;
}

async function readTransferDirectory(current) {
  return serverSupabase('/rest/v1/rpc/get_manager_transfer_directory_for_user', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: current.user.id,
      p_world_id: current.appointment.world_id
    })
  });
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);

    if (request.method === 'GET') {
      const [snapshot, offerRows] = await Promise.all([
        readTransferDirectory(current),
        serverSupabase('/rest/v1/rpc/get_manager_transfer_inbox_for_user', {
          method: 'POST',
          body: JSON.stringify({
            p_user_id: current.user.id,
            p_world_id: current.appointment.world_id
          })
        })
      ]);
      if (!snapshot?.directory) return json({ error: 'The canonical world has not been initialized' }, 409);
      const directory = snapshot.directory;
      return json({
        world_id: snapshot.world_id || current.appointment.world_id,
        club_id: current.appointment.club_id,
        turn_status: snapshot.turn_status,
        directory,
        incoming_offers: (Array.isArray(offerRows) ? offerRows : []).map((row) => projectOffer(directory, row))
      });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const stored = await readTurnState(token, current.appointment.world_id);
    if (!stored) return json({ error: 'The canonical world has not been initialized' }, 409);
    if (stored.turn_status !== 'open') return json({ error: `World commands are locked while turn is ${stored.turn_status}` }, 409);
    const body = await request.json().catch(() => ({}));
    const proposalId = String(body.proposal_id || '').trim();
    const response = String(body.response || '').trim().toLowerCase();
    if (!proposalId) return json({ error: 'Transfer proposal is required' }, 400);
    if (!['accepted', 'declined'].includes(response)) return json({ error: 'Response must be accepted or declined' }, 400);
    const requestKey = String(body.request_key || '').trim() || stableResponseKey({
      worldId: current.appointment.world_id,
      managerId: current.manager.id,
      proposalId,
      response
    });
    const rows = await serverSupabase('/rest/v1/rpc/submit_manager_transfer_response_for_user', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: current.user.id,
        p_world_id: current.appointment.world_id,
        p_proposal_id: proposalId,
        p_response: response,
        p_request_key: requestKey
      })
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return json({ accepted: true, response, proposal_id: proposalId, command_id: row?.id || null, negotiation_state: row?.negotiation_state || null });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /offer|appointment|world|response|locked/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
