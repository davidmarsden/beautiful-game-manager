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
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function canonicalFixture(world, fixtureId) {
  for (const [divisionId, runtime] of Object.entries(world.matchday_cycle?.runtimes || {})) {
    const storedFixture = (runtime.fixtures || []).find((row) => String(row.fixture_id) === fixtureId);
    if (!storedFixture) continue;
    const result = (runtime.results || []).find((row) => String(row.fixture?.fixture_id) === fixtureId) || null;
    const kickoffAt = result ? completedMatchdayKickoff(world, storedFixture.matchday) : null;
    const fixture = kickoffAt ? { ...storedFixture, kickoff_at: kickoffAt } : storedFixture;
    return { divisionId, runtime, fixture, result };
  }
  return null;
}

function clubName(world, clubId) {
  return world.club_profiles?.[clubId]?.club_name || clubId;
}

function playerName(world, playerId) {
  const player = world.squad_cycle?.players?.[playerId];
  return player?.display_name || player?.player_name || player?.canonical_name || playerId || null;
}

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
  if (!ids.length) return null;
  const minute = Number(event.minute || 0);
  return ids[(minute + index) % ids.length];
}

function decorateEvent(world, result, event, index) {
  const playerId = eventPlayerId(event, result, index);
  const resolvedName = event.player_name || playerName(world, playerId);
  const commentary = event.commentary || event.payload?.commentary || null;
  const attributedCommentary = resolvedName && commentary
    ? commentary.replace(/^A player\b/i, resolvedName)
    : commentary;
  return {
    ...event,
    ...(attributedCommentary ? { commentary: attributedCommentary } : {}),
    player_id: event.player_id || playerId,
    player_name: resolvedName,
    assist_player_name: event.assist_player_name || playerName(world, event.assist_player_id || event.payload?.assist_player_id)
  };
}

function decorateSubmission(world, submission) {
  const instruction = submission.instruction || submission.instructions || {};
  const startingXi = submission.starting_xi || instruction.starting_xi || [];
  const bench = submission.bench || instruction.bench || [];
  return {
    ...submission,
    formation: submission.formation || instruction.formation || null,
    tactics: submission.tactics || instruction.tactics || {},
    submission_source: submission.submission_source || submission.source || 'canonical_turn_submission',
    starting_xi: startingXi.map((id) => ({ id, name: playerName(world, id) })),
    bench: bench.map((id) => ({ id, name: playerName(world, id) })),
    captain_name: playerName(world, submission.captain_id || instruction.captain_id)
  };
}

function embeddedSubmission(result, fixture, clubId) {
  const side = clubId === fixture.home_club_id ? 'home' : clubId === fixture.away_club_id ? 'away' : null;
  if (!side) return null;
  const team = result.teams?.[side];
  if (!team) return null;
  return {
    club_id: clubId,
    ...team,
    submission_source: team.submission_source || team.source || 'deterministic_fallback'
  };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Match centre is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const fixtureId = String(new URL(request.url).searchParams.get('fixture_id') || '').trim();
    if (!fixtureId) return json({ error: 'fixture_id is required' }, 400);

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id`);
    if (!appointments.length) return json({ error: 'Manager has no active world appointment' }, 403);

    for (const appointment of appointments) {
      const saves = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_envelope&limit=1`);
      if (!saves[0]?.save_envelope) continue;
      const world = loadPersistentWorld(JSON.stringify(saves[0].save_envelope));
      const canonical = canonicalFixture(world, fixtureId);
      if (!canonical) continue;
      const { divisionId, fixture, result } = canonical;
      if (![fixture.home_club_id, fixture.away_club_id].includes(appointment.club_id)) return json({ error: 'You do not have access to this fixture' }, 403);
      if (!result) return json({ error: 'Match reports are available only after full time' }, 409);

      const submissionRows = await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(world.world_id)}&season_id=eq.${encodeURIComponent(world.squad_cycle.season_id)}&matchday=eq.${encodeURIComponent(fixture.matchday)}&club_id=in.(${encodeURIComponent(fixture.home_club_id)},${encodeURIComponent(fixture.away_club_id)})&select=*&order=submitted_at.desc`).catch(() => []);
      const latestByClub = new Map();
      for (const row of submissionRows) if (!latestByClub.has(row.club_id)) latestByClub.set(row.club_id, row);
      for (const clubId of [fixture.home_club_id, fixture.away_club_id]) {
        if (latestByClub.has(clubId)) continue;
        const fallback = embeddedSubmission(result, fixture, clubId);
        if (fallback) latestByClub.set(clubId, fallback);
      }

      const score = result.score || {};
      const publicFixture = {
        id: fixture.fixture_id,
        fixture_id: fixture.fixture_id,
        world_id: world.world_id,
        competition_id: divisionId,
        matchday: fixture.matchday,
        played_at: fixture.kickoff_at,
        home_club_id: fixture.home_club_id,
        away_club_id: fixture.away_club_id,
        home_club_name: clubName(world, fixture.home_club_id),
        away_club_name: clubName(world, fixture.away_club_id),
        managed_club_id: appointment.club_id,
        home_score: score.home ?? null,
        away_score: score.away ?? null
      };
      return json({
        fixture: publicFixture,
        events: (result.events || []).map((event, index) => decorateEvent(world, result, event, index)),
        submissions: [...latestByClub.values()].map((submission) => decorateSubmission(world, submission)),
        result,
        engine_contract: result.engine_contract || result.request_payload || null,
        revealed: false,
        reveal: null
      });
    }

    return json({ error: 'Fixture not found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
