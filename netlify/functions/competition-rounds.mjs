import { completedMatchdayKickoff } from '../../src/world/canonicalTurnCalendar.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};
async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const clubName = (world, clubId) => world.club_profiles?.[clubId]?.club_name || clubId;
const playerName = (world, playerId) => {
  const player = world.squad_cycle?.players?.[playerId];
  return player?.display_name || player?.player_name || player?.canonical_name || playerId || 'Unknown scorer';
};
const divisions = (world) => [...(world.competition?.divisions || [])].sort((a, b) => Number(a.level) - Number(b.level));

function candidateIds(team) {
  const rows = team?.starting_xi || team?.lineup || team?.players || [];
  return rows.map((row) => typeof row === 'string' ? row : row?.player_id || row?.id).filter(Boolean);
}
function eventPlayerId(event, result, index) {
  const direct = event.player_id || event.playerId || event.actor_id || event.payload?.player_id || event.payload?.playerId || event.payload?.actor_id;
  if (direct) return direct;
  const side = event.side === 'home' || event.side === 'away' ? event.side : null;
  if (!side) return null;
  const ids = candidateIds(result?.teams?.[side]);
  return ids.length ? ids[(Number(event.minute || 0) + index) % ids.length] : null;
}
function scorersFor(world, result, side) {
  return (result?.events || []).map((event, index) => ({ event, index }))
    .filter(({ event }) => (event.event_type || event.type || event.payload?.event_type || event.payload?.type) === 'goal' && event.side === side)
    .map(({ event, index }) => ({
      player_id: eventPlayerId(event, result, index),
      player_name: event.player_name || playerName(world, eventPlayerId(event, result, index)),
      minute: Number(event.minute || 0),
      own_goal: Boolean(event.own_goal || event.payload?.own_goal)
    }))
    .sort((a, b) => a.minute - b.minute || a.player_name.localeCompare(b.player_name));
}
function projectRoundFixture(world, fixture, result, managedClubId, divisionId) {
  const played = Boolean(result);
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
    home_score: played ? score.home ?? null : null,
    away_score: played ? score.away ?? null : null,
    result_revealed: played,
    managed_fixture: [fixture.home_club_id, fixture.away_club_id].includes(managedClubId),
    home_scorers: played ? scorersFor(world, result, 'home') : [],
    away_scorers: played ? scorersFor(world, result, 'away') : [],
    replay_available: played
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
    if (!profiles[0]) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(profiles[0].id)}&status=eq.active&select=world_id,club_id&limit=1`);
    const appointment = appointments[0];
    if (!appointment) return json({ error: 'Manager has no active world appointment' }, 403);

    const readRows = await service(`/rest/v1/world_read_model_cache?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=read_model,source_checksum,refreshed_at&limit=1`);
    const readRow = readRows[0];
    if (!readRow?.read_model) return json({ error: 'World read model is refreshing; please retry shortly' }, 503);

    const world = readRow.read_model;
    const availableDivisions = divisions(world);
    const requestedId = String(new URL(request.url).searchParams.get('division_id') || '').trim();
    const managedDivision = availableDivisions.find((row) => row.club_ids?.includes(appointment.club_id));
    const division = availableDivisions.find((row) => String(row.division_id) === requestedId) || managedDivision || availableDivisions[0];
    const runtime = division ? world.matchday_cycle?.runtimes?.[division.division_id] : null;
    if (!division || !runtime) return json({ divisions: [], division: null, rounds: [], current_matchday: null });

    const seasonRows = [...(runtime.archive_results || []), ...(runtime.results || [])];
    const resultsByFixture = new Map(seasonRows.map((result) => [String(result.fixture?.fixture_id), result]));
    const fixtures = (runtime.fixtures || []).map((fixture) => projectRoundFixture(world, fixture, resultsByFixture.get(String(fixture.fixture_id)), appointment.club_id, division.division_id))
      .sort((a, b) => a.matchday - b.matchday || String(a.kickoff_at).localeCompare(String(b.kickoff_at)) || a.fixture_id.localeCompare(b.fixture_id));
    const byMatchday = new Map();
    for (const fixture of fixtures) {
      if (!byMatchday.has(fixture.matchday)) byMatchday.set(fixture.matchday, []);
      byMatchday.get(fixture.matchday).push(fixture);
    }
    return json({
      divisions: availableDivisions.map((row) => ({ division_id: row.division_id, level: row.level, name: `Division ${row.level}`, managed: row.division_id === managedDivision?.division_id })),
      division: { division_id: division.division_id, level: division.level, name: `Division ${division.level}` },
      managed_club_id: appointment.club_id,
      current_matchday: Number(world.matchday_cycle?.current_matchday || 1),
      maximum_matchday: Number(world.matchday_cycle?.maximum_matchday || Math.max(0, ...byMatchday.keys())),
      rounds: [...byMatchday.entries()].map(([matchday, roundFixtures]) => ({ matchday, fixtures: roundFixtures })),
      canonical_source: { checksum: readRow.source_checksum, updated_at: readRow.refreshed_at, source: 'world_read_model_cache' }
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /appointment|canonical|world|read model/i.test(error.message) ? 409 : 500;
    return json({ error: error.message }, status);
  }
};
