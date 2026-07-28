import { createHash } from 'node:crypto';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function supabase(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
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

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { manager, appointment };
}

function clubName(world, clubId) {
  return String(world.club_profiles?.[clubId]?.club_name || world.club_profiles?.[clubId]?.canonical_name || clubId || 'Unknown club').trim();
}

function playerName(world, playerId) {
  const player = world.squad_cycle?.players?.[playerId];
  return String(player?.display_name || player?.player_name || player?.name || playerId || 'Unknown player').trim();
}

function transferDirectory(world, appointedClubId) {
  const clubs = [];
  const players = [];
  for (const [clubId, club] of Object.entries(world.squad_cycle?.clubs || {})) {
    clubs.push({ club_id: clubId, club_name: clubName(world, clubId), appointed: clubId === appointedClubId });
    for (const playerId of club.player_ids || []) {
      const player = world.squad_cycle?.players?.[playerId] || {};
      players.push({
        player_id: playerId,
        player_name: playerName(world, playerId),
        club_id: clubId,
        club_name: clubName(world, clubId),
        position: player.specific_position || player.primary_position || player.position || '—',
        rating: Number(player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? 0) || null
      });
    }
  }
  clubs.sort((a, b) => a.club_name.localeCompare(b.club_name));
  players.sort((a, b) => a.player_name.localeCompare(b.player_name));
  return { clubs, players };
}

function projectOffer(world, row) {
  const payload = row.command_payload || {};
  const playerId = payload.playerId || payload.player_id;
  return {
    proposal_id: row.id,
    player_id: playerId,
    player_name: playerName(world, playerId),
    buyer_club_id: row.club_id,
    buyer_club_name: clubName(world, row.club_id),
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

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const saves = await supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(current.appointment.world_id)}&select=save_envelope,turn_status&limit=1`, token);
    const stored = saves[0];
    if (!stored) return json({ error: 'The canonical world has not been initialized' }, 409);
    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));

    if (request.method === 'GET') {
      const rows = await supabase('/rest/v1/rpc/get_manager_transfer_inbox', token, {
        method: 'POST',
        body: JSON.stringify({ p_world_id: current.appointment.world_id })
      });
      return json({
        world_id: current.appointment.world_id,
        club_id: current.appointment.club_id,
        turn_status: stored.turn_status,
        directory: transferDirectory(world, current.appointment.club_id),
        incoming_offers: (Array.isArray(rows) ? rows : []).map((row) => projectOffer(world, row))
      });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
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
    const rows = await supabase('/rest/v1/rpc/submit_manager_transfer_response', token, {
      method: 'POST',
      body: JSON.stringify({
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
