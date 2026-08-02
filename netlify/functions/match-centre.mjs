const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => value === null || value === undefined || value === '' ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback;
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const prettyId = (value) => text(value).replace(/^tbg[-_:]?/i, '').replace(/[-_:]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Unknown player';
const playerIdOf = (row) => text(typeof row === 'string' ? row : row?.player_id || row?.tbg_player_id || row?.id);
const playerDisplayName = (row) => text(typeof row === 'object' ? row?.player_name || row?.display_name || row?.canonical_name || row?.name : '');

function playerLookup(world, result, submissions = []) {
  const lookup = new Map();
  const remember = (id, name) => { if (text(id) && text(name) && !lookup.has(text(id))) lookup.set(text(id), text(name)); };
  for (const [id, player] of Object.entries(world.squad_cycle?.players || {})) remember(id, playerDisplayName(player));
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
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Match centre is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const fixtureId = text(new URL(request.url).searchParams.get('fixture_id'));
    if (!fixtureId) return json({ error: 'fixture_id is required' }, 400);

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id`);
    if (!appointments.length) return json({ error: 'Manager has no active world appointment' }, 403);

    const worldIds = appointments.map((row) => row.world_id);
    const archives = await service(`/rest/v1/canonical_match_archives?fixture_id=eq.${encodeURIComponent(fixtureId)}&world_id=in.(${worldIds.map(encodeURIComponent).join(',')})&select=*&limit=1`);
    const row = archives[0];
    if (!row) return json({ error: 'Match archive is not available for this fixture' }, 404);
    const appointment = appointments.find((item) => item.world_id === row.world_id);
    const archive = row.archive_payload || {};
    const fixture = {
      ...(archive.fixture || {}),
      fixture_id: fixtureId,
      home_club_id: archive.fixture?.home_club_id || row.home_club_id,
      away_club_id: archive.fixture?.away_club_id || row.away_club_id,
      matchday: archive.fixture?.matchday || row.matchday
    };
    const result = archive.result || {};
    const world = {
      world_id: row.world_id,
      squad_cycle: { players: archive.players || {} },
      club_profiles: archive.club_profiles || {}
    };

    const submissionRows = await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(row.world_id)}&season_id=eq.${encodeURIComponent(row.season_id)}&matchday=eq.${row.matchday}&club_id=in.(${encodeURIComponent(row.home_club_id)},${encodeURIComponent(row.away_club_id)})&select=*&order=submitted_at.desc`).catch(() => []);
    const latestByClub = new Map();
    for (const submission of submissionRows) if (!latestByClub.has(submission.club_id)) latestByClub.set(submission.club_id, submission);
    for (const clubId of [row.home_club_id, row.away_club_id]) if (!latestByClub.has(clubId)) {
      const fallback = embeddedSubmission(result, fixture, clubId);
      if (fallback) latestByClub.set(clubId, fallback);
    }

    const submissions = [...latestByClub.values()];
    const lookup = playerLookup(world, result, submissions);
    const events = (result.events || []).map((event) => decorateEvent(world, lookup, event));
    const homePerformances = performanceRows(world, lookup, result, events, 'home', row.home_club_id);
    const awayPerformances = performanceRows(world, lookup, result, events, 'away', row.away_club_id);
    const performances = [...homePerformances, ...awayPerformances];
    const performancesById = new Map(performances.map((performance) => [performance.player_id, performance]));
    const rated = performances.filter((performance) => performance.rating !== null).sort((a, b) => b.rating - a.rating || a.player_name.localeCompare(b.player_name));
    const score = result.score || {};
    const clubName = (clubId) => world.club_profiles?.[clubId]?.club_name || world.club_profiles?.[clubId]?.canonical_name || clubId;
    const views = await service(`/rest/v1/manager_match_views?manager_id=eq.${encodeURIComponent(manager.id)}&fixture_id=eq.${encodeURIComponent(fixtureId)}&select=revealed_at,reveal_method&limit=1`).catch(() => []);
    const reveal = views[0] || null;

    return json({
      fixture: {
        id: fixtureId,
        fixture_id: fixtureId,
        world_id: row.world_id,
        competition_id: row.competition_id,
        matchday: row.matchday,
        played_at: row.played_at || fixture.kickoff_at || null,
        home_club_id: row.home_club_id,
        away_club_id: row.away_club_id,
        home_club_name: clubName(row.home_club_id),
        away_club_name: clubName(row.away_club_id),
        managed_club_id: appointment?.club_id || null,
        home_score: score.home ?? null,
        away_score: score.away ?? null
      },
      events,
      submissions: submissions.map((submission) => decorateSubmission(world, lookup, submission, performancesById)),
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
      ratings_version: result.model?.performance_ratings_version || null,
      revealed: Boolean(reveal?.revealed_at),
      reveal
    });
  } catch (error) {
    return json({ error: error.message }, 503);
  }
};
