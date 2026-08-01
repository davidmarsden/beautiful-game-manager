import { randomUUID } from 'node:crypto';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

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

async function canonicalWorld(token, worldId) {
  const rows = await userSupabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*&limit=1`, token);
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

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
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
    const requestedIds = Array.isArray(body.player_ids) ? [...new Set(body.player_ids.map(String))] : [];
    const currentIds = roster.players.filter((player) => player.registered).map((player) => player.player_id);
    const ownedSeniorIds = roster.players.map((player) => player.player_id);
    buildRegistrationDiff(currentIds, requestedIds, ownedSeniorIds, roster.registration_limit);
    const batchId = String(body.batch_id || randomUUID());

    const result = await serverSupabase('/rest/v1/rpc/submit_bulk_registration_commands_for_user', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: current.user.id,
        p_world_id: world.world_id,
        p_requested_player_ids: requestedIds,
        p_current_registered_ids: currentIds,
        p_owned_senior_ids: ownedSeniorIds,
        p_registration_limit: roster.registration_limit,
        p_effective_season_id: world.squad_cycle.season_id,
        p_effective_matchday: world.matchday_cycle?.current_matchday || 1,
        p_batch_id: batchId
      })
    });

    return json(Array.isArray(result) ? result[0] : result);
  } catch (error) {
    const status = /Authentication|Session/.test(error.message) ? 401 : /limit|owned|appointment|locked|world/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};