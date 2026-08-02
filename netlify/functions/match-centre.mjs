const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => value === null || value === undefined || value === ''
  ? fallback
  : Number.isFinite(Number(value)) ? Number(value) : fallback;
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

const playerIdOf = (row) => text(typeof row === 'string' ? row : row?.player_id || row?.tbg_player_id || row?.id);
const playerNameOf = (row) => text(typeof row === 'object' ? row?.player_name || row?.display_name || row?.canonical_name || row?.name : '');
const prettyId = (value) => text(value).replace(/^tbg[-_:]?/i, '').replace(/[-_:]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Unknown player';
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
  return type || subtype || 'event';
}

function playerLookup(archive, result, submissions) {
  const lookup = new Map();
  const remember = (id, name) => { if (text(id) && text(name) && !lookup.has(text(id))) lookup.set(text(id), text(name)); };
  for (const [id, player] of Object.entries(archive.players || {})) remember(id, playerNameOf(player));
  for (const team of Object.values(result.teams || {})) {
    for (const row of [...(team.starting_xi || []), ...(team.lineup || []), ...(team.players || []), ...(team.bench || [])]) remember(playerIdOf(row), playerNameOf(row));
  }
  for (const submission of submissions) {
    const instruction = submission.instruction || submission.instructions || {};
    for (const row of [...(submission.starting_xi || instruction.starting_xi || []), ...(submission.bench || instruction.bench || [])]) remember(playerIdOf(row), playerNameOf(row));
  }
  for (const event of result.events || []) {
    remember(event.player_id || event.playerId || event.actor_id || event.payload?.player_id, event.player_name || event.payload?.player_name);
    remember(event.assist_player_id || event.payload?.assist_player_id, event.assist_player_name || event.payload?.assist_player_name);
  }
  return lookup;
}

function decorateEvent(lookup, event) {
  const playerId = text(event.player_id || event.playerId || event.actor_id || event.scorer_id || event.payload?.player_id);
  const assistId = text(event.assist_player_id || event.assister_id || event.payload?.assist_player_id);
  const playerName = text(event.player_name || event.payload?.player_name || lookup.get(playerId)) || prettyId(playerId);
  const assistName = text(event.assist_player_name || event.payload?.assist_player_name || lookup.get(assistId)) || (assistId ? prettyId(assistId) : null);
  return {
    ...event,
    event_type: eventType(event),
    player_id: playerId || null,
    player_name: playerName,
    assist_player_id: assistId || null,
    assist_player_name: assistName
  };
}

function embeddedSubmission(result, fixture, clubId) {
  const side = clubId === fixture.home_club_id ? 'home' : clubId === fixture.away_club_id ? 'away' : null;
  const team = side ? result.teams?.[side] : null;
  return team ? { club_id: clubId, ...team, submission_source: team.submission_source || team.source || 'deterministic_fallback' } : null;
}

function decorateSubmission(lookup, submission) {
  const instruction = submission.instruction || submission.instructions || {};
  const decorate = (row) => {
    const id = playerIdOf(row);
    return { id, name: playerNameOf(row) || lookup.get(id) || prettyId(id), performance: null };
  };
  return {
    ...submission,
    formation: submission.formation || instruction.formation || null,
    tactics: submission.tactics || instruction.tactics || {},
    submission_source: submission.submission_source || submission.source || 'canonical_turn_submission',
    starting_xi: (submission.starting_xi || instruction.starting_xi || []).map(decorate),
    bench: (submission.bench || instruction.bench || []).map(decorate),
    captain_name: lookup.get(text(submission.captain_id || instruction.captain_id)) || null
  };
}

function goalSummary(events, side) {
  return events
    .filter((event) => event.side === side && ['goal', 'penalty_scored'].includes(event.event_type))
    .map((event) => ({
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
    const fixture = { ...(archive.fixture || {}), fixture_id: fixtureId };
    const result = archive.result || {};

    const submissionRows = await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(row.world_id)}&season_id=eq.${encodeURIComponent(row.season_id)}&matchday=eq.${row.matchday}&club_id=in.(${encodeURIComponent(row.home_club_id)},${encodeURIComponent(row.away_club_id)})&select=*&order=submitted_at.desc`).catch(() => []);
    const latestByClub = new Map();
    for (const submission of submissionRows) if (!latestByClub.has(submission.club_id)) latestByClub.set(submission.club_id, submission);
    for (const clubId of [row.home_club_id, row.away_club_id]) if (!latestByClub.has(clubId)) {
      const fallback = embeddedSubmission(result, fixture, clubId);
      if (fallback) latestByClub.set(clubId, fallback);
    }

    const submissions = [...latestByClub.values()];
    const lookup = playerLookup(archive, result, submissions);
    const events = (result.events || []).map((event) => decorateEvent(lookup, event));
    const score = result.score || {};
    const clubProfiles = archive.club_profiles || {};
    const clubName = (clubId) => clubProfiles[clubId]?.club_name || clubProfiles[clubId]?.canonical_name || clubId;
    const views = await service(`/rest/v1/manager_match_views?manager_id=eq.${encodeURIComponent(manager.id)}&fixture_id=eq.${encodeURIComponent(fixtureId)}&select=revealed_at,reveal_method&limit=1`).catch(() => []);
    const reveal = views[0] || null;

    return json({
      fixture: {
        id: fixtureId,
        fixture_id: fixtureId,
        world_id: row.world_id,
        competition_id: row.competition_id,
        matchday: row.matchday,
        played_at: row.played_at || fixture.kickoff_at || result.fixture?.kickoff_at,
        home_club_id: row.home_club_id,
        away_club_id: row.away_club_id,
        home_club_name: clubName(row.home_club_id),
        away_club_name: clubName(row.away_club_id),
        managed_club_id: appointment?.club_id || null,
        home_score: score.home ?? result.home_score ?? null,
        away_score: score.away ?? result.away_score ?? null
      },
      events,
      submissions: submissions.map((submission) => decorateSubmission(lookup, submission)),
      summary: {
        scorers: { home: goalSummary(events, 'home'), away: goalSummary(events, 'away') },
        cards: {
          home: events.filter((event) => event.side === 'home' && ['yellow_card', 'red_card', 'second_yellow'].includes(event.event_type)),
          away: events.filter((event) => event.side === 'away' && ['yellow_card', 'red_card', 'second_yellow'].includes(event.event_type))
        },
        player_of_the_match: null,
        top_ratings: []
      },
      player_performances: { home: [], away: [] },
      result,
      engine_contract: result.engine_contract || result.request_payload || null,
      revealed: Boolean(reveal?.revealed_at),
      reveal
    });
  } catch (error) {
    return json({ error: error.message }, 503);
  }
};
