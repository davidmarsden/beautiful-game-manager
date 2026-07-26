import { completedMatchdayKickoff } from '../../src/world/canonicalTurnCalendar.js';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => value === null || value === undefined || value === '' ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback;
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
    return { divisionId, fixture: kickoffAt ? { ...storedFixture, kickoff_at: kickoffAt } : storedFixture, result };
  }
  return null;
}

const clubName = (world, clubId) => world.club_profiles?.[clubId]?.club_name || clubId;
const prettyId = (value) => text(value).replace(/^tbg[-_:]?/i, '').replace(/[-_:]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Unknown player';
const playerIdOf = (row) => text(typeof row === 'string' ? row : row?.player_id || row?.tbg_player_id || row?.id);
const playerDisplayName = (row) => text(typeof row === 'object' ? row?.player_name || row?.display_name || row?.canonical_name || row?.name : '');

function playerLookup(world, result, submissions = []) {
  const lookup = new Map();
  const remember = (id, name) => { if (text(id) && text(name) && !lookup.has(text(id))) lookup.set(text(id), text(name)); };
  for (const [id, player] of Object.entries(world.squad_cycle?.players || {})) remember(id, playerDisplayName(player));
  for (const club of Object.values(world.squad_cycle?.clubs || {})) {
    for (const row of [...(club.players || []), ...(club.squad || []), ...(club.player_rows || [])]) remember(playerIdOf(row), playerDisplayName(row));
  }
  for (const team of Object.values(result?.teams || {})) {
    for (const row of [...(team.starting_xi || []), ...(team.lineup || []), ...(team.players || []), ...(team.bench || [])]) remember(playerIdOf(row), playerDisplayName(row));
  }
  for (const submission of submissions) {
    const instruction = submission.instruction || submission.instructions || {};
    for (const row of [...(submission.starting_xi || instruction.starting_xi || []), ...(submission.bench || instruction.bench || [])]) remember(playerIdOf(row), playerDisplayName(row));
  }
  for (const event of result?.events || []) {
    remember(event.player_id || event.playerId || event.actor_id || event.payload?.player_id, event.player_name || event.payload?.player_name);
    remember(event.assist_player_id || event.payload?.assist_player_id, event.assist_player_name || event.payload?.assist_player_name);
    remember(event.player_on_id || event.in_player_id || event.replacement_player_id || event.payload?.player_on_id || event.payload?.in_player_id || event.payload?.replacement_player_id, event.player_on_name || event.in_player_name || event.replacement_player_name || event.payload?.player_on_name || event.payload?.in_player_name || event.payload?.replacement_player_name);
    remember(event.player_off_id || event.out_player_id || event.replaced_player_id || event.payload?.player_off_id || event.payload?.out_player_id || event.payload?.replaced_player_id, event.player_off_name || event.out_player_name || event.replaced_player_name || event.payload?.player_off_name || event.payload?.out_player_name || event.payload?.replaced_player_name);
  }
  return lookup;
}

function canonicalPlayerName(world, lookup, playerId) {
  const id = text(playerId);
  if (!id) return '';
  return text(world.squad_cycle?.players?.[id]?.display_name || world.squad_cycle?.players?.[id]?.player_name || world.squad_cycle?.players?.[id]?.canonical_name || lookup.get(id));
}

function resolvePlayerName({ world, lookup, event = null, playerId = null, row = null }) {
  const directName = text(event?.player_name || event?.payload?.player_name || playerDisplayName(row));
  if (directName) return directName;
  const id = text(playerId || playerIdOf(row));
  if (!id) return 'Unknown player';
  return canonicalPlayerName(world, lookup, id) || prettyId(id);
}

function resolveCommentaryPlayerIds(world, lookup, commentary) {
  return String(commentary).replace(/\btbg[-_:][a-z0-9:_-]+\b/gi, (playerId) => canonicalPlayerName(world, lookup, playerId) || 'an unnamed player');
}

const eventToken = (value) => text(value).toLowerCase().replace(/[\s-]+/g, '_');
function eventType(event) {
  const type = eventToken(event.event_type || event.type || event.kind || event.payload?.event_type || event.payload?.type);
  const subtype = eventToken(event.subtype || event.event_subtype || event.payload?.subtype || event.payload?.event_subtype);
  const outcome = eventToken(event.outcome || event.result || event.payload?.outcome || event.payload?.result);

  if (subtype === 'penalty_goal') return 'penalty_scored';
  if (type === 'penalty' || subtype === 'penalty_attempt') {
    if (['scored', 'score', 'goal', 'converted', 'success'].includes(outcome)) return 'penalty_scored';
    if (['saved', 'save'].includes(outcome)) return 'penalty_saved';
    if (['missed', 'miss', 'off_target', 'wide', 'post', 'bar'].includes(outcome)) return 'penalty_missed';
    if (subtype === 'penalty_awarded' || outcome === 'awarded') return 'penalty_awarded';
  }
  if (type === 'set_piece' && subtype === 'free_kick') return 'free_kick';
  if (['free_kick', 'penalty_awarded', 'penalty_scored', 'penalty_missed', 'penalty_saved'].includes(subtype)) return subtype;
  return type || subtype || 'event';
}
const eventPlayerId = (event) => text(event.player_id || event.playerId || event.actor_id || event.scorer_id || event.booked_player_id || event.payload?.player_id || event.payload?.playerId || event.payload?.actor_id);
const assistPlayerId = (event) => text(event.assist_player_id || event.assister_id || event.payload?.assist_player_id);
function decorateEvent(world, lookup, event) {
  const playerId = eventPlayerId(event);
  const assistId = assistPlayerId(event);
  const playerName = resolvePlayerName({ world, lookup, event, playerId });
  const commentary = event.commentary || event.description || event.payload?.commentary || null;
  const resolvedCommentary = commentary ? resolveCommentaryPlayerIds(world, lookup, commentary) : null;
  return {
    ...event,
    event_type: eventType(event),
    ...(resolvedCommentary ? { commentary: playerName !== 'Unknown player' ? resolvedCommentary.replace(/^A player\b/i, playerName) : resolvedCommentary } : {}),
    player_id: playerId || null,
    player_name: playerName,
    assist_player_id: assistId || null,
    assist_player_name: assistId ? resolvePlayerName({ world, lookup, playerId: assistId }) : text(event.assist_player_name || event.payload?.assist_player_name) || null
  };
}

function rawRatingRows(result, side) {
  const sources = [
    result.player_ratings?.[side], result.ratings?.[side], result.player_performance?.[side], result.performances?.[side],
    result.teams?.[side]?.player_ratings, result.teams?.[side]?.ratings, result.lineup_state?.[side]?.player_ratings,
    result.lineup_state?.[side]?.ratings, result.lineup_state?.[side]?.performances
  ];
  const source = sources.find((value) => value && (Array.isArray(value) || typeof value === 'object'));
  if (!source) return [];
  if (Array.isArray(source)) return source;
  return Object.entries(source).map(([player_id, value]) => typeof value === 'object' ? { player_id, ...value } : { player_id, rating: value });
}

function appearances(result, side) {
  const team = result.teams?.[side] || {};
  const used = result.lineup_state?.[side]?.players_used || team.players_used || [];
  const rows = [...(team.starting_xi || []), ...(team.bench || []), ...used];
  const byId = new Map();
  for (const row of rows) {
    const id = playerIdOf(row);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  return byId;
}

function performanceRows(world, lookup, result, events, side, clubId) {
  const appearancesById = appearances(result, side);
  const explicit = new Map(rawRatingRows(result, side).map((row) => [playerIdOf(row), row]));
  const ids = new Set([...appearancesById.keys(), ...explicit.keys()]);
  for (const event of events) if (event.side === side && event.player_id) ids.add(event.player_id);
  return [...ids].map((id) => {
    const raw = explicit.get(id) || {};
    const playerEvents = events.filter((event) => event.player_id === id);
    const typeCount = (needle) => playerEvents.filter((event) => event.event_type.includes(needle)).length;
    const goalCount = playerEvents.filter((event) => ['goal', 'penalty_scored'].includes(event.event_type)).length;
    const assists = events.filter((event) => event.assist_player_id === id).length;
    return {
      player_id: id,
      player_name: resolvePlayerName({ world, lookup, playerId: id, row: appearancesById.get(id) }),
      club_id: clubId,
      side,
      rating: number(raw.rating ?? raw.performance_rating ?? raw.match_rating ?? raw.score),
      goals: number(raw.goals, goalCount),
      assists: number(raw.assists, assists),
      yellow_cards: number(raw.yellow_cards ?? raw.yellow, typeCount('yellow_card')),
      red_cards: number(raw.red_cards ?? raw.red, typeCount('red_card') + typeCount('second_yellow')),
      saves: number(raw.saves, typeCount('save')),
      tackles: number(raw.tackles, typeCount('tackle')),
      interceptions: number(raw.interceptions, typeCount('interception')),
      blocks: number(raw.blocks, typeCount('block')),
      shots: number(raw.shots),
      fouls_committed: number(raw.fouls_committed ?? raw.fouls),
      fouls_won: number(raw.fouls_won),
      minutes_played: number(raw.minutes_played ?? raw.minutes)
    };
  }).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.player_name.localeCompare(b.player_name));
}

function decorateSubmission(world, lookup, submission, performancesById) {
  const instruction = submission.instruction || submission.instructions || {};
  const decorate = (row) => {
    const id = playerIdOf(row);
    return { id, name: resolvePlayerName({ world, lookup, playerId: id, row }), performance: performancesById.get(id) || null };
  };
  return {
    ...submission,
    formation: submission.formation || instruction.formation || null,
    tactics: submission.tactics || instruction.tactics || {},
    submission_source: submission.submission_source || submission.source || 'canonical_turn_submission',
    starting_xi: (submission.starting_xi || instruction.starting_xi || []).map(decorate),
    bench: (submission.bench || instruction.bench || []).map(decorate),
    captain_name: resolvePlayerName({ world, lookup, playerId: submission.captain_id || instruction.captain_id })
  };
}

function embeddedSubmission(result, fixture, clubId) {
  const side = clubId === fixture.home_club_id ? 'home' : clubId === fixture.away_club_id ? 'away' : null;
  const team = side ? result.teams?.[side] : null;
  return team ? { club_id: clubId, ...team, submission_source: team.submission_source || team.source || 'deterministic_fallback' } : null;
}

function goalSummary(events, side) {
  return events.filter((event) => event.side === side && ['goal', 'penalty_scored'].includes(event.event_type)).map((event) => ({
    player_id: event.player_id,
    player_name: event.player_name,
    assist_player_id: event.assist_player_id,
    assist_player_name: event.assist_player_name,
    minute: number(event.minute, 0),
    penalty: event.event_type === 'penalty_scored' || Boolean(event.penalty || event.payload?.penalty),
    own_goal: Boolean(event.own_goal || event.payload?.own_goal)
  }));
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Match centre is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const fixtureId = text(new URL(request.url).searchParams.get('fixture_id'));
    if (!fixtureId) return json({ error: 'fixture_id is required' }, 400);

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!profiles[0]) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(profiles[0].id)}&status=eq.active&select=world_id,club_id`);
    if (!appointments.length) return json({ error: 'Manager has no active world appointment' }, 403);

    for (const appointment of appointments) {
      const saves = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_envelope&limit=1`);
      if (!saves[0]?.save_envelope) continue;
      const world = loadPersistentWorld(JSON.stringify(saves[0].save_envelope));
      const canonical = canonicalFixture(world, fixtureId);
      if (!canonical) continue;
      const { divisionId, fixture, result } = canonical;
      if (!result) return json({ error: 'Match reports are available only after full time' }, 409);

      const submissionRows = await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(world.world_id)}&season_id=eq.${encodeURIComponent(world.squad_cycle.season_id)}&matchday=eq.${encodeURIComponent(fixture.matchday)}&club_id=in.(${encodeURIComponent(fixture.home_club_id)},${encodeURIComponent(fixture.away_club_id)})&select=*&order=submitted_at.desc`).catch(() => []);
      const latestByClub = new Map();
      for (const row of submissionRows) if (!latestByClub.has(row.club_id)) latestByClub.set(row.club_id, row);
      for (const clubId of [fixture.home_club_id, fixture.away_club_id]) if (!latestByClub.has(clubId)) {
        const fallback = embeddedSubmission(result, fixture, clubId);
        if (fallback) latestByClub.set(clubId, fallback);
      }

      const lookup = playerLookup(world, result, [...latestByClub.values()]);
      const events = (result.events || []).map((event) => decorateEvent(world, lookup, event));
      const homePerformances = performanceRows(world, lookup, result, events, 'home', fixture.home_club_id);
      const awayPerformances = performanceRows(world, lookup, result, events, 'away', fixture.away_club_id);
      const performances = [...homePerformances, ...awayPerformances];
      const performancesById = new Map(performances.map((row) => [row.player_id, row]));
      const rated = performances.filter((row) => row.rating !== null).sort((a, b) => b.rating - a.rating || a.player_name.localeCompare(b.player_name));
      const score = result.score || {};

      return json({
        fixture: {
          id: fixture.fixture_id, fixture_id: fixture.fixture_id, world_id: world.world_id, competition_id: divisionId,
          matchday: fixture.matchday, played_at: fixture.kickoff_at, home_club_id: fixture.home_club_id,
          away_club_id: fixture.away_club_id, home_club_name: clubName(world, fixture.home_club_id),
          away_club_name: clubName(world, fixture.away_club_id), managed_club_id: appointment.club_id,
          home_score: score.home ?? null, away_score: score.away ?? null
        },
        events,
        submissions: [...latestByClub.values()].map((submission) => decorateSubmission(world, lookup, submission, performancesById)),
        summary: {
          scorers: { home: goalSummary(events, 'home'), away: goalSummary(events, 'away') },
          cards: {
            home: events.filter((event) => event.side === 'home' && ['yellow_card', 'red_card', 'second_yellow'].includes(event.event_type)),
            away: events.filter((event) => event.side === 'away' && ['yellow_card', 'red_card', 'second_yellow'].includes(event.event_type))
          },
          player_of_the_match: rated[0] || null,
          top_ratings: rated.slice(0, 3)
        },
        player_performances: { home: homePerformances, away: awayPerformances },
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