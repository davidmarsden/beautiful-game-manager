const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';
const PINK_FINAL_PLAYER_URL = process.env.TBG_PLAYER_PROFILE_URL || 'https://davidmarsden.github.io/beautiful-game-data/players/';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearerToken = (request) => { const header = request.headers.get('authorization') || ''; return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''; };
async function supabase(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Supabase ${path} returned ${response.status}`);
  return body;
}
function specificPosition(player) { return text(player.position || player.primary_position || player.position_name || player.position_detail || player.transfermarkt_position || player.canonical_position || player.position_group) || 'Unknown'; }
function loanStatus(player, ownership) {
  const loan = ownership?.loan || player.loan || {};
  const status = text(loan.status || player.loan_status).toLowerCase();
  const loanClubId = text(loan.club_id || player.loan_club_id);
  const loanClubName = text(loan.club_name || player.loan_club_name);
  return { loaned_out: Boolean(player.loaned_out || ownership?.loaned_out || status === 'loaned_out' || status === 'out' || loanClubId || loanClubName), loan_club_id: loanClubId || null, loan_club_name: loanClubName || null };
}
function squadProjection(player, index, ownership) {
  const contract = ownership?.contract || player.contract || {};
  const condition = player.condition || {};
  const transfer = player.transfer || {};
  const id = player.tbg_player_id || player.transfermarkt_id;
  const seasonStartAge = number(player.season_start_age ?? ownership?.season_start_age ?? contract.season_start_age, number(player.age, null));
  const explicitYouth = player.youth_eligible_at_season_start ?? ownership?.youth_eligible_at_season_start;
  const youthEligible = explicitYouth == null ? seasonStartAge !== null && seasonStartAge <= 21 : Boolean(explicitYouth);
  return { ...player, squad_number: number(player.squad_number, index + 1), specific_position: specificPosition(player), fitness: number(condition.fitness ?? player.fitness, 100), morale: text(condition.morale ?? player.morale) || 'Good', injury_status: text(condition.injury_status ?? player.injury_status) || 'Available', contract_expiry: text(contract.expires_on || contract.expiry_date || contract.expires_season_id) || 'Open-ended', transfer_listed: Boolean(transfer.listed ?? player.transfer_listed), loan_listed: Boolean(transfer.loan_listed ?? player.loan_listed), season_start_age: seasonStartAge, youth_eligible_at_season_start: youthEligible, squad_registration: youthEligible ? 'youth' : 'first_team', ...loanStatus(player, ownership), profile_url: `${PINK_FINAL_PLAYER_URL}?id=${encodeURIComponent(id)}` };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,email,status,is_admin,profile_completed,country,timezone,favourite_club&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile has not been created yet' }, 403);
    const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=id,world_id,club_id,control_type,appointed_at&limit=1`, token);
    const appointment = appointments[0] || null;
    const rawMessages = await supabase(`/rest/v1/manager_messages?recipient_manager_id=eq.${encodeURIComponent(manager.id)}&select=id,message_type,subject,body,priority,created_at,read_at,related_fixture_id&order=created_at.desc&limit=25`, token).catch(() => []);
    if (!appointment) return json({ authenticated: true, user: { id: user.id, email: user.email }, manager, onboarding_required: !manager.profile_completed, appointment: null, no_assignment: true, messages: rawMessages, unread_count: rawMessages.filter((m) => !m.read_at).length, navigation: ['Dashboard','Squad','Tactics','Schedule','Finances','Facilities','History','Transfers','Competitions','World'] });

    const worldResponse = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const club = world.clubs.find((row) => row.tbg_club_id === appointment.club_id);
    if (!club) return json({ error: `Assigned club ${appointment.club_id} is not present in the current world build` }, 409);
    const clubsById = new Map(world.clubs.map((row) => [row.tbg_club_id, row]));
    const playersById = new Map(world.players.map((player) => [player.tbg_player_id, player]));
    const ownershipById = new Map((world.player_ownership || []).map((row) => [row.tbg_player_id, row]));
    const squad = (club.squad?.player_ids || []).map((id) => playersById.get(id)).filter(Boolean).map((player, index) => squadProjection(player, index, ownershipById.get(player.tbg_player_id)));

    const fixtureSelect = 'id,world_id,season_id,competition_id,home_club_id,away_club_id,matchday,kickoff_at,submission_deadline_at,status,home_score,away_score,played_at';
    const clubFixtureFilter = `or=(home_club_id.eq.${encodeURIComponent(club.tbg_club_id)},away_club_id.eq.${encodeURIComponent(club.tbg_club_id)})`;
    const nextFixtures = await supabase(`/rest/v1/fixtures?${clubFixtureFilter}&status=eq.scheduled&select=${fixtureSelect}&order=kickoff_at.asc&limit=1`, token).catch(() => []);
    const fixture = nextFixtures[0] || null;
    const playedFixtures = await supabase(`/rest/v1/fixtures?${clubFixtureFilter}&status=eq.played&select=${fixtureSelect}&order=played_at.desc&limit=10`, token).catch(() => []);
    const viewRows = playedFixtures.length ? await supabase(`/rest/v1/manager_match_views?manager_id=eq.${encodeURIComponent(manager.id)}&fixture_id=in.(${playedFixtures.map((row) => encodeURIComponent(row.id)).join(',')})&select=fixture_id,revealed_at,reveal_method,replay_completed`, token).catch(() => []) : [];
    const revealByFixture = new Map(viewRows.map((row) => [row.fixture_id, row]));
    const competitionId = fixture?.competition_id || playedFixtures[0]?.competition_id || club.division_id || null;
    const seasonId = fixture?.season_id || playedFixtures[0]?.season_id || 'season-1';
    const standings = competitionId ? await supabase(`/rest/v1/competition_standings?world_id=eq.${encodeURIComponent(appointment.world_id)}&season_id=eq.${encodeURIComponent(seasonId)}&competition_id=eq.${encodeURIComponent(competitionId)}&select=*&order=position.asc`, token).catch(() => []) : [];

    const decorateFixture = (row) => {
      const opponentId = row.home_club_id === club.tbg_club_id ? row.away_club_id : row.home_club_id;
      const opponent = clubsById.get(opponentId);
      const reveal = revealByFixture.get(row.id);
      const revealed = Boolean(reveal?.revealed_at);
      return { ...row, fixture_id: row.id, opponent_name: opponent?.canonical_name || 'Opponent TBC', venue: row.home_club_id === club.tbg_club_id ? 'home' : 'away', result_revealed: revealed, reveal_method: reveal?.reveal_method || null, own_score: revealed ? (row.home_club_id === club.tbg_club_id ? row.home_score : row.away_score) : null, opponent_score: revealed ? (row.home_club_id === club.tbg_club_id ? row.away_score : row.home_score) : null };
    };
    const nextFixture = fixture ? decorateFixture(fixture) : null;
    const history = playedFixtures.map(decorateFixture);
    const hiddenFixtureIds = new Set(history.filter((row) => !row.result_revealed).map((row) => row.fixture_id));
    const messages = rawMessages.map((message) => message.message_type === 'match_result' && hiddenFixtureIds.has(message.related_fixture_id) ? { ...message, subject: 'Your match is ready', body: 'The final whistle has gone. Watch the saved replay or skip to full time to reveal the result.', priority: 'high', result_hidden: true } : message);
    const submissionRows = fixture ? await supabase(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(fixture.id)}&club_id=eq.${encodeURIComponent(club.tbg_club_id)}&select=*&limit=1`, token).catch(() => []) : [];
    const table = standings.map((row) => ({ ...row, club_name: clubsById.get(row.club_id)?.canonical_name || row.club_id, is_managed_club: row.club_id === club.tbg_club_id }));

    return json({ authenticated: true, user: { id: user.id, email: user.email }, manager, onboarding_required: !manager.profile_completed, appointment, world: { world_id: world.world_id, season_id: world.active_season_id, status: world.status }, club, squad, squad_rules: { first_team_capacity: club.squad?.first_team_capacity ?? 25, youth_team_capacity: club.squad?.youth_team_capacity ?? 20, launch_first_team_cap: club.squad?.launch_first_team_cap ?? 20, launch_youth_team_cap: club.squad?.launch_youth_team_cap ?? 10, youth_age_rule: 'Aged 21 or younger on the first day of the season' }, messages, unread_count: messages.filter((m) => !m.read_at).length, current_submission: submissionRows[0] || null, next_fixture: nextFixture ? { ...nextFixture, competition: nextFixture.competition_id || club.division_id?.replace('division-', 'Division ') || 'TBG', locked: Boolean(nextFixture.submission_deadline_at && Date.now() >= new Date(nextFixture.submission_deadline_at).getTime()) } : null, last_fixture: history[0] || null, fixture_history: history, competition: { competition_id: competitionId, season_id: seasonId, standings: table }, navigation: ['Dashboard','Squad','Tactics','Schedule','Finances','Facilities','History','Transfers','Competitions','World'] });
  } catch (error) {
    return json({ error: error.message }, 503);
  }
};
