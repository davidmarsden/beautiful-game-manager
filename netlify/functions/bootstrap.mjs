import { canonicalFixtureIds, projectManagerPortal } from '../../src/world/managerPortalProjection.js';
import { projectPinkFinalSquadLinks } from '../../src/world/pinkFinalPlayerProfile.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PINK_FINAL_BASE_URL = process.env.PINK_FINAL_BASE_URL || undefined;
const TURN_DAYS = String(process.env.TBG_TURN_DAYS || '2,5').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
const TURN_HOUR_UTC = Number(process.env.TBG_TURN_HOUR_UTC || 20);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearerToken = (request) => { const header = request.headers.get('authorization') || ''; return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''; };
const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, bearer, label = 'Supabase request', ...options } = {}) {
  const headers = { apikey: apiKey, accept: 'application/json', ...(options.headers || {}) };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: ${body.message || body.error || `Supabase returned ${response.status}`}`);
  return body;
}

const userSupabase = (path, token, label) => requestSupabase(path, {
  apiKey: SUPABASE_ANON_KEY,
  bearer: token,
  label
});
const serverSupabase = (path, options = {}, label) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {}),
  label
});

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,email,status,is_admin,profile_completed,country,timezone,favourite_club&limit=1`, token, 'Could not load manager profile');
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await userSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=id,world_id,club_id,control_type,appointed_at&limit=1`, token, 'Could not load active appointment');
  return { user, manager, appointment: appointments[0] || null };
}

function navigation() {
  return ['Dashboard','Squad','Tactics','Schedule','Finances','Facilities','History','Transfers','Competitions','World'];
}

function managerMessages(rows, world, canonicalCreatedAt) {
  const fixtureIds = canonicalFixtureIds(world);
  const createdAt = Date.parse(canonicalCreatedAt || 0);
  return rows.filter((message) => {
    if (message.related_fixture_id) return fixtureIds.has(String(message.related_fixture_id));
    return Number.isFinite(createdAt) && Date.parse(message.created_at) >= createdAt;
  });
}

function normalizeCurrentSubmission(row) {
  if (!row) return null;
  const instruction = row.instruction && typeof row.instruction === 'object' ? row.instruction : {};
  return {
    ...row,
    ...instruction,
    instruction,
    starting_xi: Array.isArray(instruction.starting_xi) ? instruction.starting_xi : [],
    bench: Array.isArray(instruction.bench) ? instruction.bench : [],
    set_piece_takers: instruction.set_piece_takers || {},
    tactics: instruction.tactics || {},
    formation: instruction.formation || null,
    captain_id: instruction.captain_id || null,
    fixture_id: instruction.fixture_id || null,
    version: row.version || instruction.version || null
  };
}

function hideCompletedScore(fixture) {
  if (!fixture || fixture.status !== 'played') return fixture;
  return { ...fixture, home_score: null, away_score: null, own_score: null, opponent_score: null, result_revealed: false };
}

function spoilerSafeProjection(projection) {
  const fixtures = (projection.fixtures || []).map(hideCompletedScore);
  const fixtureHistory = (projection.fixture_history || []).map(hideCompletedScore);
  const competition = projection.competition ? {
    ...projection.competition,
    fixtures: (projection.competition.fixtures || []).map(hideCompletedScore),
    results: (projection.competition.results || []).map(hideCompletedScore)
  } : projection.competition;
  return { ...projection, fixtures, schedule: projection.schedule || [], fixture_history: fixtureHistory, last_fixture: hideCompletedScore(projection.last_fixture), competition };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { user, manager, appointment } = await identity(token);

    if (!appointment) return json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      manager,
      onboarding_required: !manager.profile_completed,
      appointment: null,
      no_assignment: true,
      messages: [],
      unread_count: 0,
      navigation: navigation()
    });

    const context = await serverSupabase('/rest/v1/rpc/get_manager_portal_world_fragment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p_world_id: appointment.world_id, p_club_id: appointment.club_id })
    }, 'Could not load canonical portal fragment');
    if (!context?.world) return json({ error: `Canonical world ${appointment.world_id} has not been initialized`, code: 'canonical_world_not_initialized' }, 409);

    const world = context.world;
    if (world.world_id !== appointment.world_id) throw new Error('Appointment world does not match the canonical fragment');
    const projection = projectPinkFinalSquadLinks(spoilerSafeProjection(projectManagerPortal(world, appointment.club_id, {
      nextTurnAt: context.next_turn_at,
      weekdaysUtc: TURN_DAYS,
      hourUtc: TURN_HOUR_UTC
    })), { ...(PINK_FINAL_BASE_URL ? { baseUrl: PINK_FINAL_BASE_URL } : {}) });
    const currentMatchday = world.matchday_cycle?.current_matchday || 1;

    const [rawMessages, turnSubmissionRows] = await Promise.all([
      serverSupabase(`/rest/v1/manager_messages?recipient_manager_id=eq.${encodeURIComponent(manager.id)}&select=id,message_type,subject,body,priority,created_at,read_at,related_fixture_id&order=created_at.desc&limit=100`, {}, 'Could not load manager messages').catch(() => []),
      serverSupabase(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(world.world_id)}&season_id=eq.${encodeURIComponent(world.squad_cycle.season_id)}&matchday=eq.${currentMatchday}&manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(appointment.club_id)}&select=*&order=submitted_at.desc&limit=1`, {}, 'Could not load current submission').catch(() => [])
    ]);
    const messages = managerMessages(rawMessages, world, context.created_at);
    const splitLimits = world.squad_cycle?.squad_limits || {};
    const firstTeamCapacity = Number(splitLimits.first_team || 25);
    const youthTeamCapacity = Number(splitLimits.youth || 25);

    return json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      manager,
      onboarding_required: !manager.profile_completed,
      appointment,
      canonical_source: { world_id: context.world_id, checksum: context.save_checksum, updated_at: context.updated_at, next_turn_at: context.next_turn_at },
      ...projection,
      squad_rules: {
        first_team_capacity: firstTeamCapacity,
        youth_team_capacity: youthTeamCapacity,
        launch_first_team_cap: firstTeamCapacity,
        launch_youth_team_cap: youthTeamCapacity,
        overall_owned_cap: firstTeamCapacity + youthTeamCapacity,
        youth_age_rule: 'Aged 21 or younger on the first day of the season'
      },
      messages,
      unread_count: messages.filter((message) => !message.read_at).length,
      current_submission: normalizeCurrentSubmission(turnSubmissionRows[0]),
      navigation: navigation()
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /appointment|canonical|world|fragment/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
