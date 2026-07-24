import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectManagerPortal } from '../../src/world/managerPortalProjection.js';
import { buildManagerTurnSubmission } from '../../src/world/sharedWorldScheduler.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function rest(path, token, options = {}) {
  const result = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(body.message || body.error || `Supabase returned ${result.status}`);
  return body;
}

export default async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return response({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return response({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return response({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const payload = await request.json();

    const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager || manager.id !== payload.manager_id) return response({ error: 'Manager identity does not match this session' }, 403);

    const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id,world_id,club_id&limit=1`, token);
    const appointment = appointments[0];
    if (!appointment) return response({ error: 'You are not appointed to this club' }, 403);

    const storedRows = await rest(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=world_id,save_envelope,next_turn_at,turn_status&limit=1`, token);
    const stored = storedRows[0];
    if (!stored) return response({ error: `Canonical world ${appointment.world_id} has not been initialized` }, 409);
    if (stored.turn_status !== 'open') return response({ error: `Turn is ${stored.turn_status}` }, 409);

    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    if (world.world_id !== appointment.world_id) return response({ error: 'Appointment world does not match the canonical save' }, 409);
    const projection = projectManagerPortal(world, appointment.club_id);
    const fixture = projection.next_fixture;
    if (!fixture || String(fixture.fixture_id) !== String(payload.fixture_id)) return response({ error: 'Fixture is not the canonical next fixture for this club' }, 409);

    const submittedAt = new Date().toISOString();
    const submission = buildManagerTurnSubmission(world, {
      managerId: manager.id,
      clubId: appointment.club_id,
      submittedAt,
      nextTurnAt: stored.next_turn_at,
      instruction: {
        fixture_id: fixture.fixture_id,
        formation: payload.formation,
        starting_xi: payload.starting_xi,
        bench: payload.bench,
        captain_id: payload.captain_id,
        set_piece_takers: payload.set_piece_takers || {},
        tactics: payload.tactics || {}
      }
    });

    const saved = await rest('/rest/v1/manager_turn_submissions?on_conflict=world_id,season_id,matchday,club_id', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(submission)
    });

    await rest('/rest/v1/manager_messages', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({
        recipient_manager_id: manager.id,
        club_id: appointment.club_id,
        message_type: 'submission_confirmation',
        subject: 'Team submission received',
        body: `Your team and tactics have been saved for ${fixture.opponent_name}.`,
        related_fixture_id: fixture.fixture_id,
        priority: 'normal'
      })
    }).catch(() => null);

    return response({
      ...payload,
      saved: true,
      canonical: true,
      submission: saved[0] || submission,
      submitted_at: submission.submitted_at,
      matchday: submission.matchday,
      season_id: submission.season_id
    }, 200);
  } catch (error) {
    return response({ error: error.message, validation_errors: error.validationErrors || [] }, error.validationErrors ? 400 : /deadline|Turn|canonical|fixture|world/i.test(error.message) ? 409 : 500);
  }
};
