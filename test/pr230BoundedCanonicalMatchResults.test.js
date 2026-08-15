import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday, runPersistentMatchdays } from '../src/world/persistentMatchdayWorld.js';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr230-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

test('canonical runtimes retain only one full matchday while compact season results remain cumulative', () => {
  const run = runPersistentMatchdays({ world: world(), matchdays: 3 });
  assert.equal(run.accepted, true);
  assert.equal(run.final_world.matchday_cycle.current_matchday, 4);

  for (const runtime of Object.values(run.final_world.matchday_cycle.runtimes)) {
    assert.equal(runtime.results.length, 2, 'four-club division keeps only the latest two full match reports');
    assert.equal(runtime.archive_results.length, 6, 'compact season ledger keeps all six completed fixtures');
    assert.ok(runtime.results.every((row) => Number(row.fixture.matchday) === 3));
    assert.equal(new Set(runtime.archive_results.map((row) => row.fixture.fixture_id)).size, 6);
    assert.equal(runtime.state.applied_run_keys.length, 6);
    assert.ok(runtime.archive_results.every((row) => row.statistics === undefined));
    assert.ok(runtime.archive_results.every((row) => (row.events || []).every((event) => {
      const type = String(event.event_type || event.type || event.kind || '').toLowerCase();
      return type.includes('goal') || type.includes('yellow') || type.includes('red');
    })));
  }
});

test('legacy unbounded results are compacted before the next canonical save', () => {
  const first = advancePersistentMatchday(world());
  const legacy = structuredClone(first.world);
  for (const runtime of Object.values(legacy.matchday_cycle.runtimes)) delete runtime.archive_results;

  const second = advancePersistentMatchday(legacy);
  assert.equal(second.accepted, true);
  for (const runtime of Object.values(second.world.matchday_cycle.runtimes)) {
    assert.equal(runtime.results.length, 2);
    assert.ok(runtime.results.every((row) => Number(row.fixture.matchday) === 2));
    assert.equal(runtime.archive_results.length, 4);
    assert.equal(new Set(runtime.archive_results.map((row) => row.fixture.fixture_id)).size, 4);
  }
});

test('season completion still reconciles from compact archival results', () => {
  const run = runPersistentMatchdays({ world: world(), matchdays: 6 });
  assert.equal(run.accepted, true);
  assert.equal(run.final_world.phase, 'preseason');
  assert.equal(run.final_world.history.archives.length, 5);
  assert.ok(run.final_world.history.archives.every((archive) => archive.accepted));
});