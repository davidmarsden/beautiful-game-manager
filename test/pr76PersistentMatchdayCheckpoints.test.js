import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import {
  advancePersistentMatchday,
  runPersistentMatchdays,
  validatePersistentMatchdayWorld
} from '../src/world/persistentMatchdayWorld.js';
import { loadPersistentWorld } from '../src/world/persistentSeasonLoop.js';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr76-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

test('advances exactly one matchday across all five divisions and persists the cursor', () => {
  const report = advancePersistentMatchday(world());
  assert.equal(report.accepted, true);
  assert.equal(report.matchday, 1);
  assert.equal(report.season_completed, false);
  assert.equal(report.division_results.length, 5);
  assert.equal(report.checkpoint.fixture_count, 10);
  assert.equal(report.world.phase, 'season');
  assert.equal(report.world.matchday_cycle.current_matchday, 2);
  assert.equal(report.world.matchday_cycle.checkpoints.length, 1);
  assert.equal(Object.values(report.world.matchday_cycle.runtimes).reduce((sum, runtime) => sum + runtime.results.length, 0), 10);
  assert.deepEqual(canonical(loadPersistentWorld(report.saved_world)), canonical(report.world));
});

test('save and resume between matchdays matches uninterrupted advancement', () => {
  const uninterrupted = runPersistentMatchdays({ world: world(), matchdays: 3 });
  const first = advancePersistentMatchday(world());
  const resumed = runPersistentMatchdays({ world: loadPersistentWorld(first.saved_world), matchdays: 2 });

  assert.equal(uninterrupted.accepted, true);
  assert.equal(resumed.accepted, true);
  assert.deepEqual(canonical(resumed.final_world), canonical(uninterrupted.final_world));
  assert.equal(resumed.final_world.matchday_cycle.current_matchday, 4);
  assert.equal(resumed.final_world.matchday_cycle.checkpoints.length, 3);
});

test('completes the season only after the final matchday then archives and rolls over', () => {
  const run = runPersistentMatchdays({ world: world(), matchdays: 6 });
  const finalReport = run.reports.at(-1);

  assert.equal(run.accepted, true);
  assert.equal(finalReport.season_completed, true);
  assert.equal(finalReport.completion.archives.length, 5);
  assert.equal(finalReport.completion.movements.length, 8);
  assert.equal(run.final_world.phase, 'preseason');
  assert.equal(run.final_world.season_number, 2);
  assert.equal(run.final_world.matchday_cycle, undefined);
  assert.equal(run.final_world.matchday_history.length, 1);
  assert.equal(run.final_world.matchday_history[0].checkpoints.length, 6);
  assert.equal(run.final_world.history.archives.length, 5);
  assert.equal(run.final_world.competition.movement_history.length, 8);
  assert.equal(run.reports.reduce((sum, row) => sum + row.checkpoint.fixture_count, 0), 60);
  assert.equal(validatePersistentMatchdayWorld(run.final_world).valid, true);
});

test('does not replay a processed fixture when a cursor is corrupted backwards', () => {
  const first = advancePersistentMatchday(world());
  const corrupted = structuredClone(first.world);
  corrupted.matchday_cycle.current_matchday = 1;
  for (const runtime of Object.values(corrupted.matchday_cycle.runtimes)) runtime.next_matchday = 1;
  assert.throws(() => advancePersistentMatchday(corrupted), /matchday cursors disagree|Fixture already applied/);
});

test('rejects duplicate persisted checkpoint identities', () => {
  const completed = runPersistentMatchdays({ world: world(), matchdays: 6 }).final_world;
  const corrupted = structuredClone(completed);
  corrupted.matchday_history.push(structuredClone(corrupted.matchday_history[0]));
  assert.equal(validatePersistentMatchdayWorld(corrupted).valid, false);
});

test('records one human decision at each human-club matchday', () => {
  const run = runPersistentMatchdays({
    world: world(),
    matchdays: 2,
    humanInstructionsByMatchday: {
      1: { formation: '4-2-3-1', tactics: { mentality: 'positive' } },
      2: { formation: '4-3-3-wide', tactics: { pressing: 'high' } }
    }
  });
  const humanRuntime = Object.values(run.final_world.matchday_cycle.runtimes).find((runtime) => runtime.human_club_id);
  assert.equal(humanRuntime.human_decisions.length, 2);
  assert.equal(humanRuntime.human_decisions[0].formation, '4-2-3-1');
  assert.equal(humanRuntime.human_decisions[1].formation, '4-3-3-wide');
});
