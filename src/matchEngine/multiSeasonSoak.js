import { simulateStatefulSeason } from './seasonSimulation.js';
import {
  DEFAULT_PLAYABLE_DIVISION_IDS,
  syntheticPlayableLeagueStructure
} from './leagueStructureSimulation.js';
import { rollOverPlayableLeague } from './seasonRollover.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const unique = (values) => new Set(values).size === values.length;

export const MULTI_SEASON_SOAK_VERSION = 'tbg-multi-season-soak-v1.0';

export const DEFAULT_SOAK_THRESHOLDS = Object.freeze({
  minimum_average_goals_per_match: 1.5,
  maximum_average_goals_per_match: 3.5,
  minimum_draw_rate: 0.15,
  maximum_draw_rate: 0.4,
  minimum_home_win_rate: 0.2,
  maximum_home_win_rate: 0.55,
  maximum_emergency_youth_per_team_fixture: 0.2
});

function addYears(iso, years) {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function canonicalStructure(divisions) {
  const ids = divisions.map((division) => division.division_id);
  return ids.length === DEFAULT_PLAYABLE_DIVISION_IDS.length
    && unique(ids)
    && DEFAULT_PLAYABLE_DIVISION_IDS.every((id) => ids.includes(id));
}

function simulateLeagueSeason({ divisions, seasonId, startAt, daysBetweenRounds, simulator }) {
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
      ...report
    });
  });

  const checks = Object.freeze({
    canonical_division_set: canonicalStructure(divisions),
    every_division_completed: reports.every((report) => report.accepted),
    every_table_reconciles: reports.every((report) => report.standings.length === report.club_count),
    every_club_fields_eleven: reports.every((report) => report.checks.every_club_fields_eleven),
    unavailable_players_never_selected: reports.every((report) => report.checks.unavailable_players_are_never_selected)
  });

  return Object.freeze({
    season_id: seasonId,
    accepted: Object.values(checks).every(Boolean),
    checks,
    divisions: Object.freeze(reports)
  });
}

function clubIdentity(divisions) {
  return divisions.flatMap((division) => division.clubs.map((club) => club.club_id)).sort();
}

export function runMultiSeasonSoak({
  seasonCount = 50,
  divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 }),
  movementCount = 1,
  firstSeasonId = 'soak-season-1',
  startAt = '2026-08-01T15:00:00.000Z',
  daysBetweenRounds = 7,
  thresholds = DEFAULT_SOAK_THRESHOLDS,
  simulator
} = {}) {
  if (!Number.isInteger(seasonCount) || seasonCount < 2) throw new Error('Multi-season soak requires at least two integer seasons');
  if (!Array.isArray(divisions) || !canonicalStructure(divisions)) throw new Error('Multi-season soak requires the canonical d1-d5 structure');

  const originalClubIds = clubIdentity(divisions);
  const divisionSizes = Object.fromEntries(divisions.map((division) => [division.division_id, division.clubs.length]));
  const seasonSummaries = [];
  const championCounts = Object.fromEntries(originalClubIds.map((clubId) => [clubId, 0]));
  const divisionVisits = Object.fromEntries(originalClubIds.map((clubId) => [clubId, new Set()]));
  const allFixtureIds = new Set();
  let fixtureCount = 0;
  let totalGoals = 0;
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let managerDecisions = 0;
  let emergencyYouthCallups = 0;
  let outOfPositionStarters = 0;
  let totalMovements = 0;
  let acceptedRollovers = 0;
  let currentDivisions = divisions;

  for (let seasonIndex = 0; seasonIndex < seasonCount; seasonIndex += 1) {
    const seasonId = seasonIndex === 0 ? firstSeasonId : `${firstSeasonId.replace(/-1$/, '')}-${seasonIndex + 1}`;
    const completed = simulateLeagueSeason({
      divisions: currentDivisions,
      seasonId,
      startAt: addYears(startAt, seasonIndex),
      daysBetweenRounds,
      simulator
    });

    for (const division of completed.divisions) {
      const champion = division.standings[0]?.club_id;
      if (champion) championCounts[champion] = (championCounts[champion] || 0) + 1;
      for (const row of division.standings) divisionVisits[row.club_id]?.add(division.division_id);
      for (const result of division.results) {
        if (allFixtureIds.has(result.fixture.fixture_id)) throw new Error(`Duplicate fixture across soak: ${result.fixture.fixture_id}`);
        allFixtureIds.add(result.fixture.fixture_id);
        fixtureCount += 1;
        totalGoals += result.score.home + result.score.away;
        if (result.score.home > result.score.away) homeWins += 1;
        else if (result.score.away > result.score.home) awayWins += 1;
        else draws += 1;
      }
      managerDecisions += division.metrics.manager_decisions;
      emergencyYouthCallups += division.metrics.emergency_youth_callups;
      outOfPositionStarters += division.metrics.out_of_position_starters;
    }

    seasonSummaries.push(Object.freeze({
      season_number: seasonIndex + 1,
      season_id: seasonId,
      accepted: completed.accepted,
      fixture_count: completed.divisions.reduce((sum, division) => sum + division.fixture_count, 0),
      goals: completed.divisions.reduce((sum, division) => sum + division.metrics.total_goals, 0),
      champions: Object.freeze(Object.fromEntries(completed.divisions.map((division) => [division.division_id, division.standings[0].club_id])))
    }));

    if (seasonIndex < seasonCount - 1) {
      const rollover = rollOverPlayableLeague({
        divisions: currentDivisions,
        completedReport: completed,
        movementCount,
        nextSeasonId: `${firstSeasonId.replace(/-1$/, '')}-${seasonIndex + 2}`
      });
      if (rollover.accepted) acceptedRollovers += 1;
      totalMovements += rollover.movements.length;
      currentDivisions = rollover.divisions;
    }
  }

  const finalClubIds = clubIdentity(currentDivisions);
  const teamFixtures = fixtureCount * 2;
  const metrics = Object.freeze({
    seasons_completed: seasonSummaries.filter((season) => season.accepted).length,
    fixtures_played: fixtureCount,
    total_goals: totalGoals,
    average_goals_per_match: round(totalGoals / Math.max(1, fixtureCount), 3),
    home_win_rate: round(homeWins / Math.max(1, fixtureCount)),
    away_win_rate: round(awayWins / Math.max(1, fixtureCount)),
    draw_rate: round(draws / Math.max(1, fixtureCount)),
    manager_decisions: managerDecisions,
    emergency_youth_callups: emergencyYouthCallups,
    emergency_youth_per_team_fixture: round(emergencyYouthCallups / Math.max(1, teamFixtures)),
    out_of_position_starters: outOfPositionStarters,
    rollovers_completed: acceptedRollovers,
    total_movements: totalMovements,
    unique_champions: Object.values(championCounts).filter((count) => count > 0).length,
    clubs_visiting_multiple_divisions: Object.values(divisionVisits).filter((visits) => visits.size > 1).length
  });

  const checks = Object.freeze({
    requested_seasons_completed: metrics.seasons_completed === seasonCount,
    every_rollover_accepted: acceptedRollovers === seasonCount - 1,
    every_division_keeps_its_size: currentDivisions.every((division) => division.clubs.length === divisionSizes[division.division_id]),
    every_club_preserved_once: unique(finalClubIds) && JSON.stringify(finalClubIds) === JSON.stringify(originalClubIds),
    fixture_ids_unique_across_seasons: allFixtureIds.size === fixtureCount,
    two_manager_decisions_per_fixture: managerDecisions === fixtureCount * 2,
    goals_within_threshold: metrics.average_goals_per_match >= thresholds.minimum_average_goals_per_match
      && metrics.average_goals_per_match <= thresholds.maximum_average_goals_per_match,
    draw_rate_within_threshold: metrics.draw_rate >= thresholds.minimum_draw_rate
      && metrics.draw_rate <= thresholds.maximum_draw_rate,
    home_win_rate_within_threshold: metrics.home_win_rate >= thresholds.minimum_home_win_rate
      && metrics.home_win_rate <= thresholds.maximum_home_win_rate,
    emergency_youth_rate_within_threshold: metrics.emergency_youth_per_team_fixture <= thresholds.maximum_emergency_youth_per_team_fixture,
    movement_count_reconciles: totalMovements === (seasonCount - 1) * movementCount * 2 * (DEFAULT_PLAYABLE_DIVISION_IDS.length - 1)
  });

  return Object.freeze({
    version: MULTI_SEASON_SOAK_VERSION,
    season_count: seasonCount,
    movement_count_per_boundary: movementCount,
    thresholds: Object.freeze({ ...thresholds }),
    metrics,
    checks,
    season_summaries: Object.freeze(seasonSummaries),
    champion_counts: Object.freeze(championCounts),
    division_visits: Object.freeze(Object.fromEntries(Object.entries(divisionVisits).map(([clubId, visits]) => [clubId, Object.freeze([...visits].sort())]))),
    accepted: Object.values(checks).every(Boolean)
  });
}
