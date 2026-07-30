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

    const [profiles, appointments] = await Promise.all([
      userRest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token, {}, 'Could not verify manager profile'),
      userRest(`/rest/v1/manager_appointments?club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id,world_id,club_id,manager_id&limit=1`, token, {}, 'Could not verify active appointment')
    ]);
    const manager = profiles[0];
    if (!manager || manager.id !== payload.manager_id) return response({ error: 'Manager identity does not match this session' }, 403);
    const appointment = appointments[0];
    if (!appointment || appointment.manager_id !== manager.id) return response({ error: 'You are not appointed to this club' }, 403);

    const context = await serverRest('/rest/v1/rpc/get_manager_portal_world_fragment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p_world_id: appointment.world_id, p_club_id: appointment.club_id })
    }, 'Could not load canonical submission fragment');
    if (!context?.world) return response({ error: `Canonical world ${appointment.world_id} has not been initialized` }, 409);
    if (context.turn_status !== 'open') return response({ error: `Turn is ${context.turn_status}` }, 409);

    const world = context.world;
    if (world.world_id !== appointment.world_id) return response({ error: 'Appointment world does not match the canonical fragment' }, 409);
    const projection = projectManagerPortal(world, appointment.club_id, { nextTurnAt: context.next_turn_at });
    const fixture = projection.next_fixture;
    if (!fixture || String(fixture.fixture_id) !== String(payload.fixture_id)) return response({ error: 'Fixture is not the canonical next fixture for this club' }, 409);

    const canonicalFixture = findWorldFixture(world, fixture.fixture_id);
    if (!canonicalFixture) return response({ error: 'Canonical fixture could not be resolved for eligibility validation' }, 409);
    const eligibilityFixture = {
      ...canonicalFixture,
      eligibility_checkpoint_at: canonicalFixture.eligibility_checkpoint_at || canonicalFixture.lock_at || context.next_turn_at || canonicalFixture.kickoff_at
    };
    const selectedPlayerIds = [...(payload.starting_xi || []), ...(payload.bench || [])];
    const ownedPlayerIds = new Set(world.squad_cycle?.clubs?.[appointment.club_id]?.player_ids || []);
    const unownedPlayerIds = selectedPlayerIds.filter((playerId) => !ownedPlayerIds.has(playerId));
    if (unownedPlayerIds.length) {
      const error = new Error(`Selected players are not owned by this club: ${unownedPlayerIds.join(', ')}`);
      error.validationErrors = unownedPlayerIds.map((playerId) => ({ code: 'player_not_owned', player_id: playerId }));
      throw error;
    }

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
      nextTurnAt: context.next_turn_at,
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
    const { version: submissionVersion, ...submissionRow } = submission;

    const saved = await serverRest('/rest/v1/manager_turn_submissions?on_conflict=world_id,season_id,matchday,club_id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(submissionRow)
    }, 'Could not persist team submission');

    // The authoritative upsert is the success boundary. Inbox confirmation must never
    // delay or invalidate an already-persisted team selection.
    return response({ ...payload, saved: true, canonical: true, submission: saved[0] || submissionRow, submission_version: submissionVersion, submitted_at: submission.submitted_at, matchday: submission.matchday, season_id: submission.season_id });
  } catch (error) {
    return response({ error: error.message, validation_errors: error.validationErrors || [] }, error.validationErrors ? 400 : /deadline|Turn|canonical|fixture|world|fragment/i.test(error.message) ? 409 : 500);
  }
};
