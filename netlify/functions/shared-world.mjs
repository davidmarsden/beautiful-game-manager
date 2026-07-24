import { buildManagerTurnSubmission, currentTurnIdentity } from '../../src/world/sharedWorldScheduler.js';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectManagerPortal } from '../../src/world/managerPortalProjection.js';

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
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,is_admin&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

async function readCanonicalWorld(token, worldId) {
  const rows = await supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*&limit=1`, token);
  return rows[0] || null;
}

async function readSubmission(token, current, turn) {
  const rows = await supabase(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(turn.world_id)}&season_id=eq.${encodeURIComponent(turn.season_id)}&matchday=eq.${turn.matchday}&manager_id=eq.${encodeURIComponent(current.manager.id)}&select=*&limit=1`, token);
  return rows[0] || null;
}

async function readCommandHistory(token, current) {
  return supabase(`/rest/v1/manager_world_commands?world_id=eq.${encodeURIComponent(current.appointment.world_id)}&manager_id=eq.${encodeURIComponent(current.manager.id)}&select=id,command_type,command_payload,status,effective_season_id,effective_matchday,submitted_at,processed_at,outcome_reason,outcome_details,superseded_by&order=submitted_at.desc,id.desc&limit=100`, token);
}

function assertAppointment(world, appointment) {
  if (world.world_id !== appointment.world_id) throw new Error('Appointment world does not match the canonical world');
  if (!world.squad_cycle?.clubs?.[appointment.club_id]) throw new Error('Appointment club is not present in the canonical world');
}

function playerName(world, playerId) {
  const player = world.squad_cycle?.players?.[playerId];
  return String(player?.display_name || player?.player_name || player?.name || playerId || 'Unknown player').trim();
}

function clubName(world, clubId) {
  return String(world.club_profiles?.[clubId]?.club_name || world.club_profiles?.[clubId]?.canonical_name || clubId || 'Unknown club').trim();
}

function appointmentSummary(world, clubId) {
  const projection = projectManagerPortal(world, clubId);
  const club = world.squad_cycle.clubs[clubId];
  return {
    world_id: world.world_id,
    season_id: world.squad_cycle.season_id,
    season_number: world.season_number,
    phase: world.phase,
    clock: world.clock,
    human_club_id: clubId,
    club_name: projection.club.canonical_name,
    division_name: projection.club.division_name,
    owned_players: club.player_ids.length,
    registered_players: club.registered_player_ids.length,
    current_matchday: world.matchday_cycle?.current_matchday || null,
    maximum_matchday: world.matchday_cycle?.maximum_matchday || null,
    next_fixture: projection.next_fixture
  };
}

function commandType(type) {
  const allowed = new Set(['register_player','unregister_player','renew_contract','transfer_offer','transfer_listing','transfer_response']);
  if (!allowed.has(type)) throw new Error(`Unsupported shared-world command: ${type}`);
  return type;
}

function commandSummaryImpl(world, row) {
  const rawPayload = row.command_payload || {};
  const playerId = rawPayload.playerId || rawPayload.player_id || null;
  const otherClubId = rawPayload.otherClubId || rawPayload.other_club_id || null;
  return {
    id: row.id,
    type: row.command_type,
    payload: {
      ...rawPayload,
      ...(playerId ? { player_id: playerId, playerId: playerName(world, playerId), player_name: playerName(world, playerId) } : {}),
      ...(otherClubId ? { other_club_id: otherClubId, otherClubId, other_club_name: clubName(world, otherClubId) } : {})
    },
    display: {
      player_id: playerId,
      player_name: playerId ? playerName(world, playerId) : null,
      other_club_id: otherClubId,
      other_club_name: otherClubId ? clubName(world, otherClubId) : null,
      manager_club_name: clubName(world, row.club_id)
    },
    status: row.status,
    effective_season_id: row.effective_season_id,
    effective_matchday: row.effective_matchday,
    submitted_at: row.submitted_at,
    processed_at: row.processed_at,
    outcome_reason: row.outcome_reason || null,
    outcome_details: row.outcome_details || {},
    superseded_by: row.superseded_by || null
  };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const stored = await readCanonicalWorld(token, current.appointment.world_id);
    if (!stored) return json({
      configured: true,
      has_world: false,
      world_id: current.appointment.world_id,
      club_id: current.appointment.club_id,
      is_admin: Boolean(current.manager.is_admin),
      message: 'The shared-world database is ready, but this world has not yet been initialized.'
    });
    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    assertAppointment(world, current.appointment);
    const turn = currentTurnIdentity(world);
    const [existing, commandRows] = await Promise.all([
      readSubmission(token, current, turn),
      readCommandHistory(token, current)
    ]);
    const summary = appointmentSummary(world, current.appointment.club_id);
    const appointment = { ...current.appointment, club_name: summary.club_name, division_name: summary.division_name };
    const commandSummary = (row) => commandSummaryImpl(world, row);

    if (request.method === 'GET') {
      return json({
        configured: true,
        has_world: true,
        is_admin: Boolean(current.manager.is_admin),
        summary,
        world: {
          world_id: stored.world_id,
          checksum: stored.save_checksum,
          updated_at: stored.updated_at,
          next_turn_at: stored.next_turn_at,
          turn_status: stored.turn_status
        },
        appointment,
        turn,
        submission: existing ? {
          status: existing.status,
          instruction: existing.instruction,
          submitted_at: existing.submitted_at,
          locked_at: existing.locked_at
        } : null,
        commands: commandRows.map(commandSummary)
      });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));

    if (body.type === 'submit_turn') {
      if (stored.turn_status !== 'open') return json({ error: `Turn is ${stored.turn_status}` }, 409);
      const submission = buildManagerTurnSubmission(world, {
        managerId: current.manager.id,
        clubId: current.appointment.club_id,
        instruction: body.instruction || {},
        submittedAt: new Date().toISOString(),
        nextTurnAt: stored.next_turn_at
      });
      const rows = await supabase('/rest/v1/manager_turn_submissions?on_conflict=world_id,season_id,matchday,club_id', token, {
        method: 'POST',
        body: JSON.stringify(submission),
        headers: { prefer: 'resolution=merge-duplicates,return=representation' }
      });
      return json({ accepted: true, command: 'submit_turn', submission: rows[0] || submission, turn, summary });
    }

    if (body.type === 'submit_command') {
      if (stored.turn_status !== 'open') return json({ error: `World commands are locked while turn is ${stored.turn_status}` }, 409);
      const type = commandType(body.command_type);
      const payload = {
        world_id: world.world_id,
        manager_id: current.manager.id,
        club_id: current.appointment.club_id,
        command_type: type,
        command_payload: body.command_payload || {},
        status: 'pending',
        effective_season_id: turn.season_id,
        effective_matchday: turn.matchday
      };
      const rows = await supabase('/rest/v1/manager_world_commands', token, { method: 'POST', body: JSON.stringify(payload) });
      return json({ accepted: true, command: type, request: commandSummaryImpl(world, rows[0] || payload), turn, summary });
    }

    return json({ error: 'Managers cannot save, load, import, restore or advance the shared world' }, 403);
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /deadline|Turn|appointment|world|submission|command/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};