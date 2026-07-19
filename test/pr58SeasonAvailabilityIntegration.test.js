import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

function availabilitySimulator(records, { massAbsence = false } = {}) {
  let first = true;
  return (contract) => {
    records.push({
      fixture: contract.fixture,
      home: [...contract.teams.home.starting_xi],
      away: [...contract.teams.away.starting_xi],
      match_state: contract.match_state
    });
    const targetIds = first
      ? contract.teams.home.starting_xi.slice(0, massAbsence ? 8 : 1)
      : [];
    first = false;
    return {
      result_version: '2d5-v1',
      run_key: contract.run_key,
      fixture_id: contract.fixture.fixture_id,
      status: 'completed',
      score: { home: 1, away: 0 },
      outcome: 'home_win',
      events: [],
      statistics: { home: {}, away: {} },
      lineup_state: {},
      state_changes: {
        fitness: [],
        injuries: targetIds.map((player_id) => ({ player_id, matches_out: 2, injury_type: 'test_injury' })),
        discipline: []
      }
    };
  };
}

test('season selection honours injury windows and restores players after recovery', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4 });
  const records = [];
  const report = simulateStatefulSeason({
    clubs,
    seasonId: 'pr58-availability-integration',
    simulator: availabilitySimulator(records)
  });

  const target = records[0].home[0];
  const targetClub = clubs.find((club) => club.players.some((player) => player.tbg_player_id === target));
  const targetFixtures = records.filter((row) => (
    row.fixture.home_club_id === targetClub.club_id || row.fixture.away_club_id === targetClub.club_id
  ));

  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.metrics.injury_absences, 1);
  assert.equal(report.metrics.unavailable_selections, 0);
  assert.ok(![...targetFixtures[1].home, ...targetFixtures[1].away].includes(target));
  assert.ok(![...targetFixtures[2].home, ...targetFixtures[2].away].includes(target));
  assert.ok([...targetFixtures[3].home, ...targetFixtures[3].away].includes(target));
  assert.equal(targetFixtures[1].match_state.players[target], undefined);
});

test('availability integration refuses to field an ineligible emergency XI', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4 });
  assert.throws(
    () => simulateStatefulSeason({
      clubs,
      seasonId: 'pr58-insufficient-eligible-squad',
      simulator: availabilitySimulator([], { massAbsence: true })
    }),
    /only 10 eligible players/
  );
});

test('season availability behaviour is deterministic for identical inputs', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4 });
  const first = simulateStatefulSeason({ clubs, seasonId: 'pr58-repeatable', simulator: availabilitySimulator([]) });
  const second = simulateStatefulSeason({ clubs, seasonId: 'pr58-repeatable', simulator: availabilitySimulator([]) });
  assert.deepEqual(first.results.map((row) => row.teams), second.results.map((row) => row.teams));
  assert.deepEqual(first.metrics, second.metrics);
  assert.deepEqual(first.final_availability, second.final_availability);
});
