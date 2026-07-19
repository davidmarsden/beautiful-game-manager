import { simulateStatefulSeason, syntheticSeasonClubs } from './seasonSimulation.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const unique = (values) => new Set(values).size === values.length;

export const LEAGUE_STRUCTURE_SIMULATION_VERSION = 'tbg-complete-league-structure-harness-v1.0';
export const DEFAULT_PLAYABLE_DIVISION_COUNT = 5;

function namespaceClub(club, divisionId) {
  const playerIdMap = new Map(club.players.map((player) => [
    player.tbg_player_id,
    `${divisionId}-${player.tbg_player_id}`
  ]));

  return Object.freeze({
    ...club,
    club_id: `${divisionId}-${club.club_id}`,
    club_name: `${divisionId.toUpperCase()} ${club.club_name}`,
    players: Object.freeze(club.players.map((player) => Object.freeze({
      ...player,
      tbg_player_id: playerIdMap.get(player.tbg_player_id),
      display_name: `${divisionId.toUpperCase()} ${player.display_name}`
    })))
  });
}

function divisionAverageRating(clubs) {
  const ratings = clubs.flatMap((club) => club.players.slice(0, 11).map((player) => player.underlying_ability_rating));
  return round(ratings.reduce((sum, rating) => sum + rating, 0) / Math.max(1, ratings.length), 3);
}

export function syntheticPlayableLeagueStructure({
  divisionCount = DEFAULT_PLAYABLE_DIVISION_COUNT,
  clubsPerDivision = 6,
  topDivisionBaseRating = 90,
  ratingDropPerDivision = 1.5
} = {}) {
  if (!Number.isInteger(divisionCount) || divisionCount < 2) throw new Error('League structure requires at least two integer divisions');
  if (!Number.isInteger(clubsPerDivision) || clubsPerDivision < 4 || clubsPerDivision % 2 !== 0) {
    throw new Error('Each playable division requires an even number of at least four clubs');
  }

  return Object.freeze(Array.from({ length: divisionCount }, (_, index) => {
    const divisionId = `d${index + 1}`;
    const baseRating = topDivisionBaseRating - index * ratingDropPerDivision;
    const clubs = syntheticSeasonClubs({ clubCount: clubsPerDivision, baseRating })
      .map((club) => namespaceClub(club, divisionId));

    return Object.freeze({
      division_id: divisionId,
      level: index + 1,
      club_count: clubs.length,
      average_starting_rating: divisionAverageRating(clubs),
      clubs: Object.freeze(clubs)
    });
  }));
}

function structureIdentityChecks(divisions) {
  const clubIds = divisions.flatMap((division) => division.clubs.map((club) => club.club_id));
  const playerIds = divisions.flatMap((division) => division.clubs.flatMap((club) => club.players.map((player) => player.tbg_player_id)));
  return {
    unique_division_ids: unique(divisions.map((division) => division.division_id)),
    unique_club_ids: unique(clubIds),
    unique_player_ids: unique(playerIds),
    every_club_belongs_to_one_division: clubIds.length === new Set(clubIds).size,
    division_strength_descends: divisions.slice(1).every((division, index) => (
      divisions[index].average_starting_rating > division.average_starting_rating
    ))
  };
}

export function simulateCompleteLeagueStructure({
  divisions = syntheticPlayableLeagueStructure(),
  seasonId = 'complete-league-season',
  startAt = '2026-08-01T15:00:00.000Z',
  daysBetweenRounds = 7,
  simulator
} = {}) {
  if (!Array.isArray(divisions) || divisions.length < 2) throw new Error('Complete league simulation requires multiple divisions');

  const identityChecks = structureIdentityChecks(divisions);
  if (!Object.values(identityChecks).every(Boolean)) {
    throw new Error(`Invalid playable league identity: ${JSON.stringify(identityChecks)}`);
  }

  const reports = divisions.map((division) => {
    const report = simulateStatefulSeason({
      clubs: division.clubs,
      seasonId: `${seasonId}:${division.division_id}`,
      startAt,
      daysBetweenRounds,
      ...(simulator ? { simulator } : {})
    });
    return Object.freeze({
      division_id: division.division_id,
      level: division.level,
      average_starting_rating: division.average_starting_rating,
      ...report
    });
  });

  const totalFixtures = reports.reduce((sum, report) => sum + report.fixture_count, 0);
  const totalGoals = reports.reduce((sum, report) => sum + report.metrics.total_goals, 0);
  const totalClubs = reports.reduce((sum, report) => sum + report.club_count, 0);
  const allFixtureIds = reports.flatMap((report) => report.results.map((row) => row.fixture.fixture_id));
  const allEventCount = reports.reduce((sum, report) => sum + report.metrics.unique_public_event_ids, 0);
  const checks = Object.freeze({
    ...identityChecks,
    every_division_completed: reports.every((report) => report.accepted),
    every_division_has_a_full_table: reports.every((report) => report.standings.length === report.club_count),
    fixture_ids_are_globally_unique: unique(allFixtureIds),
    fixture_totals_reconcile: totalFixtures === reports.reduce((sum, report) => sum + report.results.length, 0),
    all_playable_divisions_present: reports.length === divisions.length,
    public_events_exist_across_structure: allEventCount > 0
  });

  return Object.freeze({
    version: LEAGUE_STRUCTURE_SIMULATION_VERSION,
    season_id: seasonId,
    division_count: reports.length,
    club_count: totalClubs,
    fixture_count: totalFixtures,
    divisions: Object.freeze(reports),
    metrics: Object.freeze({
      total_goals: totalGoals,
      average_goals_per_match: round(totalGoals / Math.max(1, totalFixtures), 3),
      unique_public_event_ids: allEventCount,
      minimum_final_fitness: round(Math.min(...reports.map((report) => report.metrics.minimum_final_fitness)), 3),
      maximum_final_fitness: round(Math.max(...reports.map((report) => report.metrics.maximum_final_fitness)), 3)
    }),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
