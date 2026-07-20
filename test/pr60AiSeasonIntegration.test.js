import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

function deterministicSimulator(contract) {
  const homeStrength = contract.teams.home.starting_xi.reduce((sum, id) => sum + Number(contract.match_state.players[id]?.fitness ?? 0), 0);
  const awayStrength = contract.teams.away.starting_xi.reduce((sum, id) => sum + Number(contract.match_state.players[id]?.fitness ?? 0), 0);
  const score = homeStrength >= awayStrength ? { home: 1, away: 0 } : { home: 0, away: 1 };
  return {
    fixture_id: contract.fixture.fixture_id,
    run_key: contract.run_key,
    score,
    outcome: score.home > score.away ? 'home_win' : 'away_win',
    statistics: {},
    lineup_state: {},
    events: [],
    state_changes: { fitness: [] }
  };
}

test('every autonomous season fixture uses deterministic AI manager decisions', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4, baseRating: 86 });
  const options = { clubs, seasonId: 'pr60-ai-season', simulator: deterministicSimulator };
  const first = simulateStatefulSeason(options);
  const second = simulateStatefulSeason(options);

  assert.deepEqual(first, second);
  assert.equal(first.accepted, true);
  assert.equal(first.metrics.manager_decisions, first.fixture_count * 2);
  assert.equal(first.checks.manager_decision_for_every_team, true);
  assert.equal(first.checks.manager_decisions_are_positionally_valid, true);
  assert.equal(first.checks.manager_tactics_present, true);

  for (const result of first.results) {
    for (const side of ['home', 'away']) {
      const team = result.teams[side];
      assert.equal(team.starting_xi.length, 11);
      assert.equal(new Set(team.starting_xi).size, 11);
      assert.ok(team.formation);
      assert.ok(team.tactics);
      assert.ok(team.manager_decision);
      assert.equal(team.starting_xi.some((id) => team.bench.includes(id)), false);
    }
  }
});

test('season manager decisions preserve availability exclusions and opponent-aware tactics', () => {
  const output = simulateStatefulSeason({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'pr60-ai-season-tactics',
    simulator: deterministicSimulator
  });

  assert.equal(output.metrics.unavailable_selections, 0);
  assert.ok(output.metrics.tactical_adjustments > 0);
  assert.ok(output.results.some((row) =>
    row.teams.home.tactics.mentality !== 'balanced'
    || row.teams.away.tactics.mentality !== 'balanced'));
});
