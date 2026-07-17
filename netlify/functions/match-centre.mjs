const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};

async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Match centre is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const url = new URL(request.url);
    const fixtureId = String(url.searchParams.get('fixture_id') || '').trim();
    if (!fixtureId) return json({ error: 'fixture_id is required' }, 400);

    const profiles = await service(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile not found' }, 403);
    const appointments = await service(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id`);
    const fixtureRows = await service(`/rest/v1/fixtures?id=eq.${encodeURIComponent(fixtureId)}&select=*&limit=1`);
    const fixture = fixtureRows[0];
    if (!fixture) return json({ error: 'Fixture not found' }, 404);
    const appointment = appointments.find((row) => row.world_id === fixture.world_id && [fixture.home_club_id, fixture.away_club_id].includes(row.club_id));
    if (!appointment) return json({ error: 'You do not have access to this fixture' }, 403);
    if (fixture.status !== 'played') {
      return json({ error: 'Match reports are available only after full time' }, 409);
    }

    const [events, submissions, runs, worldResponse] = await Promise.all([
      service(`/rest/v1/match_events?fixture_id=eq.${encodeURIComponent(fixtureId)}&select=*&order=minute.asc,event_id.asc`),
      service(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(fixtureId)}&select=club_id,formation,starting_xi,bench,captain_id,tactics,set_piece_takers,submission_source,version`),
      service(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(fixtureId)}&select=result_payload,request_payload&limit=1`),
      fetch(WORLD_URL, { headers: { accept: 'application/json' } })
    ]);
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const clubs = new Map((world.clubs || []).map((club) => [club.tbg_club_id, club]));
    const players = new Map((world.players || []).map((player) => [player.tbg_player_id, player]));
    const playerName = (id) => {
      const player = players.get(id);
      return player?.display_name || player?.player_name || player?.canonical_name || id || null;
    };
    const decorateSubmission = (submission) => ({
      ...submission,
      starting_xi: (submission.starting_xi || []).map((id) => ({ id, name: playerName(id) })),
      bench: (submission.bench || []).map((id) => ({ id, name: playerName(id) })),
      captain_name: playerName(submission.captain_id)
    });
    const run = runs[0] || {};
    return json({
      fixture: {
        ...fixture,
        home_club_name: clubs.get(fixture.home_club_id)?.canonical_name || fixture.home_club_id,
        away_club_name: clubs.get(fixture.away_club_id)?.canonical_name || fixture.away_club_id,
        managed_club_id: appointment.club_id
      },
      events: events.map((event) => ({ ...event, player_name: playerName(event.player_id), assist_player_name: playerName(event.assist_player_id) })),
      submissions: submissions.map(decorateSubmission),
      result: run.result_payload || fixture.result_payload || {},
      engine_contract: run.request_payload || null
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};