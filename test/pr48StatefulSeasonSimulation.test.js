import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDoubleRoundRobin,
  syntheticSeasonClubs,
  simulateStatefulSeason
} from '../src/matchEngine/seasonSimulation.js';

function stubResult(contract, { events = [], injuries = [] } = {}) {
  return {
    fixture_id: contract.fixture.fixture_id,
    run_key: contract.run_key,
    score: { home: 0, away: 0 },
    outcome: 'draw',
    statistics: {},
    lineup_state: {},
    events,
    state_changes: { fitness: [], injuries, discipline: [] }
  };
}

test('double round robin schedules every ordered home-and-away pairing once', () => {
  const clubs = ['a', 'b', 'c', 'd', 'e', 'f'];
  const fixtures = buildDoubleRoundRobin(clubs, { seasonId: 'schedule-test' });
  assert.equal(fixtures.length, 30);
  for (const home of clubs) {
    for (const away of clubs) {
      if (home === away) continue;
      assert.equal(fixtures.filter((row) => row.home_club_id === home && row.away_club_id === away).length, 1);
    }
  }
});

test('constitutional engine completes a stateful season with reconciled standings', () => {
  const report = simulateStatefulSeason({ clubs: syntheticSeasonClubs({ clubCount: 6 }), seasonId: 'pr48-full-season' });
  assert.equal(report.fixture_count, 30);
  assert.equal(report.results.length, 30);
  assert.equal(report.standings.length, 6);
  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.equal(report.standings.reduce((sum, row) => sum + row.gf, 0), report.standings.reduce((sum, row) => sum + row.ga, 0));
  assert.ok(report.metrics.average_goals_per_match >= 0);
  assert.ok(report.metrics.minimum_final_fitness >= 0);
  assert.ok(report.metrics.maximum_final_fitness <= 100);
});

test('the full-season harness is deterministic for identical season inputs', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4 });
  const first = simulateStatefulSeason({ clubs, seasonId: 'deterministic-season', daysBetweenRounds: 4 });
  const second = simulateStatefulSeason({ clubs, seasonId: 'deterministic-season', daysBetweenRounds: 4 });
  assert.deepEqual(first.standings, second.standings);
  assert.deepEqual(first.results.map((row) => row.score), second.results.map((row) => row.score));
  assert.deepEqual(first.metrics, second.metrics);
});

test('congested seasons carry state between fixtures rather than resetting fitness', () => {
  const report = simulateStatefulSeason({ clubs: syntheticSeasonClubs({ clubCount: 4 }), seasonId: 'congested-season', daysBetweenRounds: 3 });
  assert.ok(report.metrics.minimum_final_fitness < 100);
  assert.equal(report.checks.no_duplicate_state_application, true);
  assert.equal(report.checks.fitness_stays_bounded, true);
});

test('depleted squads still field eleven without selecting injured players', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4 }).map((club) => (
    club.club_id === 'club-1' ? { ...club, players: club.players.slice(0, 11) } : club
  ));
  let injured = false;
  const simulator = (contract) => {
    const clubOneTeam = contract.teams.home.club_id === 'club-1' ? contract.teams.home : contract.teams.away.club_id === 'club-1' ? contract.teams.away : null;
    const injuries = !injured && clubOneTeam
      ? [{ player_id: clubOneTeam.starting_xi[0] }]
      : [];
    if (injuries.length) injured = true;
    return stubResult(contract, { events: [{ event_id: `${contract.fixture.fixture_id}:event-1` }], injuries });
  };

  const report = simulateStatefulSeason({ clubs, seasonId: 'depleted-squad', simulator });
  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.checks.every_club_fields_eleven, true);
  assert.equal(report.metrics.unavailable_selections, 0);
  assert.ok(report.metrics.emergency_youth_callups > 0);
});

test('events without a non-empty public event ID are rejected', () => {
  const simulator = (contract) => stubResult(contract, { events: [{}] });
  assert.throws(
    () => simulateStatefulSeason({ clubs: syntheticSeasonClubs({ clubCount: 4 }), seasonId: 'missing-event-id', simulator }),
    /event without a public event ID/
  );
});
