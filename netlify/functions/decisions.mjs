import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectManagerPortal } from '../../src/world/managerPortalProjection.js';
import { buildManagerTurnSubmission } from '../../src/world/sharedWorldScheduler.js';
import { createLoanEligibilitySnapshot, findWorldFixture, ineligibleLoanPlayerIds } from '../../src/world/loanEligibility.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, bearer: bearerCredential, label = 'Supabase request', ...options } = {}) {
  const headers = {
    apikey: apiKey,
    accept: 'application/json',
    ...(options.headers || {})
  };
  if (bearerCredential) headers.authorization = `Bearer ${bearerCredential}`;
  const result = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`${label}: ${body.message || body.error || `Supabase returned ${result.status}`}`);
  return body;
}

const userRest = (path, token, options = {}, label) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_ANON_KEY,
  bearer: token,
  label
});
const serverRest = (path, options = {}, label) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {}),
  label
});

export default async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return response({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return response({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return response({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const payload = await request.json();

    const profiles = await userRest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token, {}, 'Could not verify manager profile');
    const manager = profiles[0];
    if (!manager || manager.id !== payload.manager_id) return response({ error: 'Manager identity does not match this session' }, 403);

    const appointments = await userRest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id,world_id,club_id&limit=1`, token, {}, 'Could not verify active appointment');
    const appointment = appointments[0];
    if (!appointment) return response({ error: 'You are not appointed to this club' }, 403);

    const storedRows = await serverRest(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=world_id,save_envelope,next_turn_at,turn_status&limit=1`, {}, 'Could not load canonical world');
    const stored = storedRows[0];
    if (!stored) return response({ error: `Canonical world ${appointment.world_id} has not been initialized` }, 409);
    if (stored.turn_status !== 'open') return response({ error: `Turn is ${stored.turn_status}` }, 409);

    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    if (world.world_id !== appointment.world_id) return response({ error: 'Appointment world does not match the canonical save' }, 409);
    const projection = projectManagerPortal(world, appointment.club_id);
    const fixture = projection.next_fixture;
    if (!fixture || String(fixture.fixture_id) !== String(payload.fixture_id)) return response({ error: 'Fixture is not the canonical next fixture for this club' }, 409);

    const canonicalFixture = findWorldFixture(world, fixture.fixture_id);
    if (!canonicalFixture) return response({ error: 'Canonical fixture could not be resolved for eligibility validation' }, 409);
    const eligibilityFixture = {
      ...canonicalFixture,
      eligibility_checkpoint_at: canonicalFixture.eligibility_checkpoint_at || canonicalFixture.lock_at || stored.next_turn_at || canonicalFixture.kickoff_at
    };
    const selectedPlayerIds = [...(payload.starting_xi || []), ...(payload.bench || [])];
    const loanEligibilitySnapshot = createLoanEligibilitySnapshot({
      playerIds: selectedPlayerIds,
      clubId: appointment.club_id,
      fixture: eligibilityFixture,
      world
    });
    const restrictedLoanPlayers = ineligibleLoanPlayerIds({
      playerIds: selectedPlayerIds,
      clubId: appointment.club_id,
      fixture: eligibilityFixture,
      world,
      snapshot: loanEligibilitySnapshot
    });
    if (restrictedLoanPlayers.length) {
      const error = new Error(`Loan players cannot face their parent club in this competition: ${restrictedLoanPlayers.join(', ')}`);
      error.validationErrors = restrictedLoanPlayers.map((playerId) => ({ code: 'parent_club_fixture', player_id: playerId, checkpoint: loanEligibilitySnapshot.checkpoint }));
      throw error;
    }

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
        tactics: payload.tactics || {},
        loan_eligibility_snapshot: loanEligibilitySnapshot
      }
    });

    const saved = await serverRest('/rest/v1/manager_turn_submissions?on_conflict=world_id,season_id,matchday,club_id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(submission)
    }, 'Could not persist team submission');

    await serverRest('/rest/v1/manager_messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ recipient_manager_id: manager.id, club_id: appointment.club_id, message_type: 'submission_confirmation', subject: 'Team submission received', body: `Your team and tactics have been saved for ${fixture.opponent_name}.`, related_fixture_id: fixture.fixture_id, priority: 'normal' })
    }, 'Could not create submission confirmation').catch(() => null);

    return response({ ...payload, saved: true, canonical: true, submission: saved[0] || submission, submitted_at: submission.submitted_at, matchday: submission.matchday, season_id: submission.season_id });
  } catch (error) {
    return response({ error: error.message, validation_errors: error.validationErrors || [] }, error.validationErrors ? 400 : /deadline|Turn|canonical|fixture|world/i.test(error.message) ? 409 : 500);
  }
};