import test from 'node:test';
import assert from 'node:assert/strict';
import { runMultiSeasonSoak } from '../src/matchEngine/multiSeasonSoak.js';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';

function hash(value) {
  return [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
}

function deterministicSimulator(contract) {
  const outcome = hash(contract.fixture.fixture_id) % 3;
  const score = outcome === 0 ? { home: 2, away: 1 } : outcome === 1 ? { home: 1, away: 1 } : { home: 1, away: 2 };
  return {
    fixture_id: contract.fixture.fixture_id,
    run_key: contract.run_key,
    score,
    outcome: score.home > score.away ? 'home_win' : score.away > score.home ? 'away_win' : 'draw',
    statistics: {},
    lineup_state: {},
    events: [],
    state_changes: { fitness: [], injuries: [], discipline: [] }
  };
}

test('multi-season soak is deterministic and completes every requested season', () => {
  const options = {
    seasonCount: 6,
    divisions: syntheticPlayableLeagueStructure({ clubsPerDivision: 4 }),
    firstSeasonId: 'pr61-soak-1',
    simulator: deterministicSimulator
  };
  const first = runMultiSeasonSoak(options);
  const second = runMultiSeasonSoak(options);

  assert.deepEqual(first, second);
  assert.equal(first.accepted, true, JSON.stringify(first.checks, null, 2));
  assert.equal(first.metrics.seasons_completed, 6);
  assert.equal(first.metrics.rollovers_completed, 5);
  assert.equal(first.metrics.fixtures_played, 360);
  assert.equal(first.metrics.manager_decisions, 720);
});

test('soak preserves every club and division size through repeated promotion and relegation', () => {
  const report = runMultiSeasonSoak({
    seasonCount: 8,
    divisions: syntheticPlayableLeagueStructure({ clubsPerDivision: 4 }),
    firstSeasonId: 'pr61-preservation-1',
    simulator: deterministicSimulator
  });

  assert.equal(report.checks.every_club_preserved_once, true);
  assert.equal(report.checks.every_division_keeps_its_size, true);
  assert.equal(report.checks.every_rollover_accepted, true);
  assert.equal(report.checks.movement_count_reconciles, true);
  assert.equal(report.metrics.total_movements, 56);
  assert.ok(report.metrics.clubs_visiting_multiple_divisions > 0);
});

test('soak applies explicit aggregate football thresholds', () => {
  const report = runMultiSeasonSoak({
    seasonCount: 5,
    divisions: syntheticPlayableLeagueStructure({ clubsPerDivision: 4 }),
    firstSeasonId: 'pr61-thresholds-1',
    simulator: deterministicSimulator
  });

  assert.equal(report.checks.goals_within_threshold, true);
  assert.equal(report.checks.draw_rate_within_threshold, true);
  assert.equal(report.checks.home_win_rate_within_threshold, true);
  assert.equal(report.checks.emergency_youth_rate_within_threshold, true);
  assert.equal(report.checks.fixture_ids_unique_across_seasons, true);
});
