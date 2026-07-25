import { createHash, randomUUID } from 'node:crypto';
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

async function canonicalWorld(token, worldId) {
  const rows = await supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*&limit=1`, token);
  if (!rows[0]) throw new Error('Canonical world has not been initialized');
  return rows[0];
}

const playerId = (player) => String(player?.tbg_player_id || player?.player_id || player?.id || '').trim();
const isSenior = (player) => Number(player?.age ?? 99) > 21;

export function registrationRoster(world, clubId) {
  const club = world.squad_cycle?.clubs?.[clubId];
  if (!club) throw new Error('Appointment club is not present in the canonical world');
  const registered = new Set(club.registered_player_ids || []);
  const players = (club.player_ids || [])
    .map((id) => world.squad_cycle.players[id])
    .filter(Boolean)
    .filter(isSenior)
    .map((player) => ({
      player_id: playerId(player),
      display_name: String(player.display_name || player.name || playerId(player)),
      age: Number(player.age || 0),
      position: String(player.specific_position || player.position || 'Unknown'),
      rating: Number(player.underlying_ability_rating || player.rating || 0),
      registered: registered.has(playerId(player))
    }))
    .sort((left, right) => right.rating - left.rating || left.display_name.localeCompare(right.display_name));
  return {
    registration_limit: Number(world.squad_cycle.registration_limit || 25),
    players
  };
}

export function buildRegistrationDiff(currentIds, requestedIds, ownedSeniorIds, limit = 25) {
  const owned = new Set(ownedSeniorIds);
  const requested = [...new Set(requestedIds.map(String))];
  if (requested.length > limit) throw new Error(`Senior registration is limited to ${limit} players`);
  const unknown = requested.filter((id) => !owned.has(id));
  if (unknown.length) throw new Error(`Registration contains players not owned by this club: ${unknown.join(', ')}`);
  const current = new Set(currentIds.map(String));
  const desired = new Set(requested);
  return {
    unregister: [...current].filter((id) => owned.has(id) && !desired.has(id)),
    register: requested.filter((id) => !current.has(id))
  };
}

function requestKey({ worldId, managerId, batchId, commandType, playerIdValue }) {
  return createHash('sha256').update([worldId, managerId, batchId, commandType, playerIdValue].join('|')).digest('hex');
}

async function submitCommand({ token, world, managerId, clubId, batchId, commandType, playerIdValue }) {
  const seasonId = world.squad_cycle.season_id;
  const matchday = world.matchday_cycle?.current_matchday || 1;
  const key = requestKey({ worldId: world.world_id, managerId, batchId, commandType, playerIdValue });
  return supabase('/rest/v1/rpc/submit_manager_world_command', token, {
    method: 'POST',
    body: JSON.stringify({
      p_world_id: world.world_id,
      p_manager_id: managerId,
      p_club_id: clubId,
      p_command_type: commandType,
      p_command_payload: { playerId: playerIdValue, batch_id: batchId, client_request_id: key },
      p_effective_season_id: seasonId,
      p_effective_matchday: matchday,
      p_request_key: key
    })
  });
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const stored = await canonicalWorld(token, current.appointment.world_id);
    if (stored.turn_status !== 'open') return json({ error: `World commands are locked while turn is ${stored.turn_status}` }, 409);
    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    const roster = registrationRoster(world, current.appointment.club_id);

    if (request.method === 'GET') return json({
      world_id: world.world_id,
      club_id: current.appointment.club_id,
      registration_limit: roster.registration_limit,
      selected_count: roster.players.filter((player) => player.registered).length,
      players: roster.players
    });

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.player_ids) ? body.player_ids : [];
    const currentIds = roster.players.filter((player) => player.registered).map((player) => player.player_id);
    const ownedSeniorIds = roster.players.map((player) => player.player_id);
    const diff = buildRegistrationDiff(currentIds, requestedIds, ownedSeniorIds, roster.registration_limit);
    const batchId = String(body.batch_id || randomUUID());
    const submitted = [];

    for (const id of diff.unregister) {
      await submitCommand({ token, world, managerId: current.manager.id, clubId: current.appointment.club_id, batchId, commandType: 'unregister_player', playerIdValue: id });
      submitted.push({ player_id: id, action: 'remove' });
    }
    for (const id of diff.register) {
      await submitCommand({ token, world, managerId: current.manager.id, clubId: current.appointment.club_id, batchId, commandType: 'register_player', playerIdValue: id });
      submitted.push({ player_id: id, action: 'register' });
    }

    return json({
      accepted: true,
      batch_id: batchId,
      requested_count: requestedIds.length,
      command_count: submitted.length,
      unchanged_count: requestedIds.length - diff.register.length,
      submitted
    });
  } catch (error) {
    const status = /Authentication|Session/.test(error.message) ? 401 : /limit|owned|appointment|locked|world/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
