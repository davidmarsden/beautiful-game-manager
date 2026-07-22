import { buildManagerTurnSubmission, currentTurnIdentity } from '../../src/world/sharedWorldScheduler.js';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { portalWorldSummary } from '../../src/world/portalWorldControl.js';

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
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name&limit=1`, token);
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

function assertAppointment(world, appointment) {
  if (world.world_id !== appointment.world_id) throw new Error('Appointment world does not match the canonical world');
  if (!world.squad_cycle?.clubs?.[appointment.club_id]) throw new Error('Appointment club is not present in the canonical world');
}

function commandType(type) {
  const allowed = new Set(['register_player','unregister_player','renew_contract','transfer_offer','transfer_listing','transfer_response']);
  if (!allowed.has(type)) throw new Error(`Unsupported shared-world command: ${type}`);
  return type;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const stored = await readCanonicalWorld(token, current.appointment.world_id);
    if (!stored) return json({ configured: true, has_world: false, world_id: current.appointment.world_id, club_id: current.appointment.club_id }, 409);
    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    assertAppointment(world, current.appointment);
    const turn = currentTurnIdentity(world);
    const existing = await readSubmission(token, current, turn);

    if (request.method === 'GET') {
      return json({
        configured: true,
        has_world: true,
        summary: portalWorldSummary(world),
        world: {
          world_id: stored.world_id,
          checksum: stored.save_checksum,
          updated_at: stored.updated_at,
          next_turn_at: stored.next_turn_at,
          turn_status: stored.turn_status
        },
        appointment: current.appointment,
        turn,
        submission: existing ? {
          status: existing.status,
          instruction: existing.instruction,
          submitted_at: existing.submitted_at,
          locked_at: existing.locked_at
        } : null
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
      return json({ accepted: true, command: 'submit_turn', submission: rows[0] || submission, turn, summary: portalWorldSummary(world) });
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
      return json({ accepted: true, command: type, request: rows[0] || payload, turn, summary: portalWorldSummary(world) });
    }

    return json({ error: 'Managers cannot save, load, import, restore or advance the shared world' }, 403);
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /deadline|Turn|appointment|world|submission|command/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
