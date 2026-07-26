import { completedMatchdayKickoff } from '../../src/world/canonicalTurnCalendar.js';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};

async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const clubName = (world, clubId) => world.club_profiles?.[clubId]?.club_name || clubId;

function divisionForClub(world, clubId) {
  return (world.competition?.divisions || []).find((division) => division.club_ids?.includes(clubId)) || null;
}

function projectRoundFixture(world, fixture, result, managedClubId, divisionId) {
  const played = Boolean(result);
  const managedFixture = [fixture.home_club_id, fixture.away_club_id].includes(managedClubId);
  const score = result?.score || {};
  const playedAt = played ? completedMatchdayKickoff(world, fixture.matchday) || fixture.kickoff_at : null;
  return {
    fixture_id: fixture.fixture_id,
    competition_id: divisionId,
    matchday: Number(fixture.matchday),
    kickoff_at: fixture.kickoff_at || null,
    played_at: playedAt,
    home_club_id: fixture.home_club_id,
    home_club_name: clubName(world, fixture.home_club_id),
    away_club_id: fixture.away_club_id,
    away_club_name: clubName(world, fixture.away_club_id),
    status: played ? 'played' : 'scheduled',
    home_score: played && !managedFixture ? score.home ?? null : null,
    away_score: played && !managedFixture ? score.away ?? null : null,
    result_revealed: played && !managedFixture,
    managed_fixture: managedFixture
  };
}

export default async (request) => {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Competition rounds are not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`);
    const appointment = appointments[0];
    if (!appointment) return json({ error: 'Manager has no active world appointment' }, 403);
    const saves = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_envelope&limit=1`);
    if (!saves[0]?.save_envelope) return json({ error: 'Canonical world has not been initialized' }, 409);

    const world = loadPersistentWorld(JSON.stringify(saves[0].save_envelope));
    const division = divisionForClub(world, appointment.club_id);
    const runtime = division ? world.matchday_cycle?.runtimes?.[division.division_id] : null;
    if (!division || !runtime) return json({ division: null, rounds: [], current_matchday: null });
    const resultsByFixture = new Map((runtime.results || []).map((result) => [String(result.fixture?.fixture_id), result]));
    const fixtures = (runtime.fixtures || [])
      .map((fixture) => projectRoundFixture(world, fixture, resultsByFixture.get(String(fixture.fixture_id)), appointment.club_id, division.division_id))
      .sort((a, b) => a.matchday - b.matchday || String(a.kickoff_at).localeCompare(String(b.kickoff_at)) || a.fixture_id.localeCompare(b.fixture_id));
    const byMatchday = new Map();
    for (const fixture of fixtures) {
      if (!byMatchday.has(fixture.matchday)) byMatchday.set(fixture.matchday, []);
      byMatchday.get(fixture.matchday).push(fixture);
    }
    return json({
      division: { division_id: division.division_id, level: division.level, name: `Division ${division.level}` },
      managed_club_id: appointment.club_id,
      current_matchday: Number(world.matchday_cycle?.current_matchday || 1),
      maximum_matchday: Number(world.matchday_cycle?.maximum_matchday || Math.max(0, ...byMatchday.keys())),
      rounds: [...byMatchday.entries()].map(([matchday, roundFixtures]) => ({ matchday, fixtures: roundFixtures }))
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /appointment|canonical|world/i.test(error.message) ? 409 : 500;
    return json({ error: error.message }, status);
  }
};
