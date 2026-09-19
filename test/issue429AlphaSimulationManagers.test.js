import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { buildScheduledTurnPlan, executeScheduledTurn, ALPHA_SIMULATION_SOURCE } from '../src/world/sharedWorldScheduler.js';

function fullAlphaWorld() {
  const divisions = syntheticPlayableLeagueStructure({
    divisionCount: 5,
    clubsPerDivision: 16
  });
  return createPersistentLeagueWorld({
    worldId: 'issue-429-eighty-club-alpha',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

test('issue #429: an 80-club alpha matchday runs with one human club and 79 simulation-controlled clubs', { timeout: 180000 }, () => {
  const source = fullAlphaWorld();
  const appointment = {
    world_id: source.world_id,
    manager_id: 'human-manager',
    club_id: source.human_club_id,
    status: 'active',
    control_type: 'human'
  };

  const plan = buildScheduledTurnPlan(source, [], {
    appointments: [appointment],
    scheduledFor: '2026-09-19T20:00:00.000Z',
    simulationEnabled: true
  });

  assert.equal(Object.keys(source.squad_cycle.clubs).length, 80);
  assert.equal(plan.simulation_count, 79);
  assert.equal(plan.human_fallback_count, 1);
  assert.equal(plan.simulation_club_ids.length, 79);
  assert.ok(plan.simulation_club_ids.every((clubId) =>
    plan.instruction_sources_by_club[clubId].type === ALPHA_SIMULATION_SOURCE
  ));

  const result = executeScheduledTurn(source, plan);
  assert.equal(result.accepted, true);
  assert.equal(result.advance.checkpoint.fixture_count, 40);
  assert.equal(result.world.shared_turn_history[0].simulation_count, 79);
  assert.equal(result.world.shared_turn_history[0].human_fallback_count, 1);

  let simulatedTeams = 0;
  let humanFallbackTeams = 0;
  for (const runtime of Object.values(result.world.matchday_cycle.runtimes)) {
    for (const row of runtime.results) {
      for (const team of [row.teams.home, row.teams.away]) {
        if (team.instruction_source.type === ALPHA_SIMULATION_SOURCE) simulatedTeams += 1;
        if (team.instruction_source.type === 'deterministic_fallback') humanFallbackTeams += 1;
      }
    }
  }

  assert.equal(simulatedTeams, 79);
  assert.equal(humanFallbackTeams, 1);
});
