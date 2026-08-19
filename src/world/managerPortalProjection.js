import { canonicalMatchdayKickoffs, completedMatchdayKickoff } from './canonicalTurnCalendar.js';
import { competitiveRegistration, isYouthRegistrationExempt } from './registrationEligibility.js';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function resultForClub(result, clubId) {
  const fixture = result?.fixture;
  const score = result?.score;
  if (!fixture || !score || ![fixture.home_club_id, fixture.away_club_id].includes(clubId)) return null;
  const own = fixture.home_club_id === clubId ? score.home : score.away;
  const opponent = fixture.home_club_id === clubId ? score.away : score.home;
  return own > opponent ? 'W' : own < opponent ? 'L' : 'D';
}

function orderedStandings(table = {}, results = []) {
  return Object.values(table)
    .map((row) => ({
      ...row,
      goals_for: number(row.goals_for ?? row.gf, 0),
      goals_against: number(row.goals_against ?? row.ga, 0),
      goal_difference: number(row.goal_difference ?? row.gd, 0),
      form: results
        .filter((result) => [result?.fixture?.home_club_id, result?.fixture?.away_club_id].includes(row.club_id))
        .sort((a, b) => number(a.fixture?.matchday, 0) - number(b.fixture?.matchday, 0))
        .slice(-5)
        .map((result) => resultForClub(result, row.club_id))
        .filter(Boolean)
    }))
    .sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for || a.club_id.localeCompare(b.club_id))
    .map((row, index) => ({ position: index + 1, ...row }));
}

function clubDivision(world, clubId) {
  return (world.competition?.divisions || []).find((division) => division.club_ids?.includes(clubId)) || null;
}

function clubName(world, clubId) {
  return text(world.club_profiles?.[clubId]?.club_name) || text(clubId) || 'Unknown club';
}

function runtimeForClub(world, clubId) {
  const division = clubDivision(world, clubId);
  return division ? world.matchday_cycle?.runtimes?.[division.division_id] || null : null;
}

function decorateFixture(world, clubId, fixture, result = null) {
  if (!fixture) return null;
  const opponentId = fixture.home_club_id === clubId ? fixture.away_club_id : fixture.home_club_id;
  const score = result?.score || null;
  return {
    ...fixture,
    id: fixture.fixture_id,
    fixture_id: fixture.fixture_id,
    home_club_name: clubName(world, fixture.home_club_id),
    away_club_name: clubName(world, fixture.away_club_id),
    opponent_id: opponentId,
    opponent_name: clubName(world, opponentId),
    venue: fixture.home_club_id === clubId ? 'home' : 'away',
    competition_id: clubDivision(world, clubId)?.division_id || null,
    competition: clubDivision(world, clubId) ? `Division ${clubDivision(world, clubId).level}` : 'League',
    status: result ? 'played' : 'scheduled',
    played_at: result ? fixture.kickoff_at : null,
    home_score: score?.home ?? null,
    away_score: score?.away ?? null,
    own_score: score ? (fixture.home_club_id === clubId ? score.home : score.away) : null,
    opponent_score: score ? (fixture.home_club_id === clubId ? score.away : score.home) : null,
    result_revealed: Boolean(result)
  };
}

function projectPlayer(world, club, playerId, index) {
  const player = world.squad_cycle.players[playerId];
  const contract = player?.contract_id ? world.squad_cycle.contracts?.[player.contract_id] : null;
  const runtime = runtimeForClub(world, player?.club_id);
  const condition = runtime?.state?.players?.[playerId] || {};
  const availability = runtime?.state?.availability?.players?.[playerId] || {};
  const currentMatchday = world.matchday_cycle?.current_matchday || 1;
  const injured = Number(availability.injury_until_matchday || 0) >= currentMatchday;
  const suspended = Number(availability.suspension_until_matchday || 0) >= currentMatchday;
  const registration = competitiveRegistration(world, club, playerId, player);
  const isYouthEligible = isYouthRegistrationExempt(player, contract);
  return {
    ...player,
    registered: registration.registered,
    registration_status: registration.status,
    squad_number: number(player?.squad_number, index + 1),
    specific_position: text(player?.specific_position || player?.position || player?.primary_position || player?.position_group) || 'Unknown',
    fitness: number(condition.fitness, 100),
    morale: text(condition.morale ?? player?.morale) || 'Good',
    injury_status: injured ? 'Injured' : suspended ? 'Suspended' : 'Available',
    contract_expiry: text(contract?.end_at) || 'Open-ended',
    transfer_listed: Boolean(player?.transfer_listed),
    loan_listed: Boolean(player?.loan_listed),
    youth_eligible_at_season_start: isYouthEligible,
    loaned_out: Boolean(player?.loaned_out),
    profile_url: player?.profile_url || null
  };
}

export function canonicalFixtureIds(world) {
  return new Set(Object.values(world.matchday_cycle?.runtimes || {}).flatMap((runtime) => runtime.fixtures || []).map((fixture) => String(fixture.fixture_id)));
}

function projectedFixtures(world, fixtures, resultsByFixture, nextTurnAt, { weekdaysUtc, hourUtc } = {}) {
  const currentMatchday = Number(world.matchday_cycle?.current_matchday || 1);
  const maximumMatchday = Number(world.matchday_cycle?.maximum_matchday || currentMatchday);
  const persistedCalendar = world.matchday_cycle?.turn_calendar || {};
  const resolvedWeekdays = weekdaysUtc || persistedCalendar.weekdays_utc;
  const resolvedHour = hourUtc ?? persistedCalendar.hour_utc;
  const kickoffByMatchday = nextTurnAt && maximumMatchday >= currentMatchday
    ? canonicalMatchdayKickoffs({
      firstMatchday: currentMatchday,
      firstKickoffAt: nextTurnAt,
      lastMatchday: maximumMatchday,
      ...(resolvedWeekdays ? { weekdaysUtc: resolvedWeekdays } : {}),
      ...(resolvedHour != null ? { hourUtc: resolvedHour } : {})
    })
    : new Map();
  return fixtures.map((fixture) => {
    if (resultsByFixture.has(String(fixture.fixture_id))) {
      const kickoffAt = completedMatchdayKickoff(world, fixture.matchday);
      return kickoffAt ? { ...fixture, kickoff_at: kickoffAt } : fixture;
    }
    const kickoffAt = kickoffByMatchday.get(Number(fixture.matchday));
    return kickoffAt ? { ...fixture, kickoff_at: kickoffAt } : fixture;
  });
}

export function projectManagerPortal(world, clubId, { nextTurnAt = null, weekdaysUtc = null, hourUtc = null } = {}) {
  const club = world.squad_cycle?.clubs?.[clubId];
  const profile = world.club_profiles?.[clubId];
  if (!club || !profile) throw new Error(`Appointment club ${clubId} is not present in the canonical world`);
  const division = clubDivision(world, clubId);
  const runtime = runtimeForClub(world, clubId);
  const rawFixtures = (runtime?.fixtures || []).filter((fixture) => fixture.home_club_id === clubId || fixture.away_club_id === clubId);
  const results = [...(runtime?.archive_results || []), ...(runtime?.results || [])];
  const resultsByFixture = new Map(results.map((result) => [String(result.fixture.fixture_id), result]));
  const fixtures = projectedFixtures(world, rawFixtures, resultsByFixture, nextTurnAt, { weekdaysUtc, hourUtc });
  const completed = fixtures.filter((fixture) => resultsByFixture.has(String(fixture.fixture_id)));
  const scheduled = fixtures.filter((fixture) => !resultsByFixture.has(String(fixture.fixture_id)));
  const next = [...scheduled].sort((a, b) => a.matchday - b.matchday || String(a.kickoff_at).localeCompare(String(b.kickoff_at)))[0] || null;
  const last = [...completed].sort((a, b) => b.matchday - a.matchday || String(b.kickoff_at).localeCompare(String(a.kickoff_at)))[0] || null;
  const standings = orderedStandings(runtime?.table || {}, results).map((row) => ({
    ...row,
    club_name: clubName(world, row.club_id),
    is_managed_club: row.club_id === clubId
  }));
  const squad = (club.player_ids || []).map((playerId, index) => projectPlayer(world, club, playerId, index));
  const phase = text(world.phase) || 'preseason';
  const preseason = !world.matchday_cycle || fixtures.length === 0;
  const decoratedFixtures = fixtures
    .map((fixture) => decorateFixture(world, clubId, fixture, resultsByFixture.get(String(fixture.fixture_id))))
    .sort((a, b) => a.matchday - b.matchday || String(a.kickoff_at).localeCompare(String(b.kickoff_at)));
  const splitLimits = world.squad_cycle?.squad_limits || {};
  const firstTeamCapacity = Number(splitLimits.first_team || 25);
  const youthTeamCapacity = Number(splitLimits.youth || 25);

  return {
    world: {
      world_id: world.world_id,
      display_name: text(world.display_name) || 'The Beautiful Game',
      season_id: world.squad_cycle.season_id,
      season_number: world.season_number,
      phase,
      fixture_count: fixtures.length,
      status: preseason ? 'Preseason — fixtures have not been generated yet' : `Season ${world.season_number} · Matchday ${world.matchday_cycle.current_matchday}`
    },
    season: {
      season_id: world.squad_cycle.season_id,
      fixture_count: fixtures.length,
      current_matchday: world.matchday_cycle?.current_matchday || null,
      maximum_matchday: world.matchday_cycle?.maximum_matchday || null
    },
    club: {
      ...profile,
      tbg_club_id: clubId,
      club_id: clubId,
      canonical_name: clubName(world, clubId),
      short_name: text(profile.short_name) || clubName(world, clubId),
      division_id: division?.division_id || null,
      division_name: division ? `Division ${division.level}` : null,
      strength: profile.strength || {},
      squad: {
        player_ids: [...(club.player_ids || [])],
        registered_player_ids: [...(club.registered_player_ids || [])],
        first_team_capacity: firstTeamCapacity,
        youth_team_capacity: youthTeamCapacity
      }
    },
    squad,
    fixtures: decoratedFixtures,
    schedule: decoratedFixtures,
    next_fixture: next ? decorateFixture(world, clubId, next) : null,
    last_fixture: last ? decorateFixture(world, clubId, last, resultsByFixture.get(String(last.fixture_id))) : null,
    fixture_history: completed
      .map((fixture) => decorateFixture(world, clubId, fixture, resultsByFixture.get(String(fixture.fixture_id))))
      .sort((a, b) => b.matchday - a.matchday),
    competition: {
      competition_id: division?.division_id || null,
      season_id: world.squad_cycle.season_id,
      fixture_count: fixtures.length,
      fixtures: decoratedFixtures,
      results: completed.map((fixture) => decorateFixture(world, clubId, fixture, resultsByFixture.get(String(fixture.fixture_id)))),
      standings
    },
    preseason
  };
}
