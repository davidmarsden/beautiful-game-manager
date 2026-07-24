import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { canonicalFixtureIds, projectManagerPortal } from '../../src/world/managerPortalProjection.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearerToken = (request) => { const header = request.headers.get('authorization') || ''; return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''; };

async function supabase(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase ${path} returned ${response.status}`);
  return body;
}

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,email,status,is_admin,profile_completed,country,timezone,favourite_club&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=id,world_id,club_id,control_type,appointed_at&limit=1`, token);
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

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { user, manager, appointment } = await identity(token);
    const rawMessages = await supabase(`/rest/v1/manager_messages?recipient_manager_id=eq.${encodeURIComponent(manager.id)}&select=id,message_type,subject,body,priority,created_at,read_at,related_fixture_id&order=created_at.desc&limit=100`, token).catch(() => []);

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

    const storedRows = await supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=world_id,save_envelope,save_checksum,season_id,season_number,phase,matchday,next_turn_at,turn_status,created_at,updated_at&limit=1`, token);
    const stored = storedRows[0];
    if (!stored) return json({
      error: `Canonical world ${appointment.world_id} has not been initialized`,
      code: 'canonical_world_not_initialized'
    }, 409);

    const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    if (world.world_id !== appointment.world_id) throw new Error('Appointment world does not match the canonical save');
    const projection = projectManagerPortal(world, appointment.club_id);
    const messages = managerMessages(rawMessages, world, stored.created_at);
    const turnSubmissionRows = await supabase(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(world.world_id)}&season_id=eq.${encodeURIComponent(world.squad_cycle.season_id)}&manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(appointment.club_id)}&select=*&order=submitted_at.desc&limit=1`, token).catch(() => []);

    return json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      manager,
      onboarding_required: !manager.profile_completed,
      appointment,
      canonical_source: {
        world_id: stored.world_id,
        checksum: stored.save_checksum,
        updated_at: stored.updated_at
      },
      ...projection,
      squad_rules: {
        first_team_capacity: world.squad_cycle.registration_limit || 25,
        youth_team_capacity: 20,
        launch_first_team_cap: world.squad_cycle.registration_limit || 25,
        launch_youth_team_cap: 20,
        youth_age_rule: 'Aged 21 or younger on the first day of the season'
      },
      messages,
      unread_count: messages.filter((message) => !message.read_at).length,
      current_submission: turnSubmissionRows[0] || null,
      navigation: navigation()
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /appointment|canonical|world/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
