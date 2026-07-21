import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import {
  advancePersistentLeagueSeason,
  createPersistentLeagueWorld,
  runPersistentLeagueSeasons,
  validatePersistentLeagueWorld
} from '../src/world/persistentLeagueWorld.js';
import { loadPersistentWorld, savePersistentWorld } from '../src/world/persistentSeasonLoop.js';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr75-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function membership(worldState) {
  return Object.fromEntries(worldState.competition.divisions.map((division) => [division.division_id, [...division.club_ids]]));
}

test('creates and round-trips a canonical persistent five-division world', () => {
  const created = world();
  const loaded = loadPersistentWorld(savePersistentWorld(created));
  assert.equal(validatePersistentLeagueWorld(loaded).valid, true);
  assert.deepEqual(membership(loaded), membership(created));
  assert.equal(loaded.competition.divisions.length, 5);
  assert.deepEqual(loaded.competition.divisions.map((row) => row.level), [1, 2, 3, 4, 5]);
});

test('persists promotion, relegation and five division archives through rollover', () => {
  const report = advancePersistentLeagueSeason(world());
  assert.equal(report.accepted, true);
  assert.equal(report.archives.length, 5);
  assert.equal(report.movements.length, 8);
  assert.equal(report.world.history.archives.length, 5);
  assert.equal(report.world.competition.movement_history.length, 8);
  assert.equal(report.world.season_number, 2);
  assert.equal(report.world.phase, 'preseason');
  assert.equal(Object.values(report.checks).every(Boolean), true);

  for (const movement of report.movements) {
    assert.ok(report.world.competition.divisions.find((row) => row.division_id === movement.to_division_id).club_ids.includes(movement.club_id));
    assert.equal(report.world.competition.divisions.find((row) => row.division_id === movement.from_division_id).club_ids.includes(movement.club_id), false);
  }
});

test('repeated multi-division seasons preserve unique membership and history', () => {
  const first = runPersistentLeagueSeasons({ seasons: 2, world: world() });
  const second = runPersistentLeagueSeasons({ seasons: 2, world: world() });
  assert.equal(first.accepted, true);
  assert.deepEqual(first, second);
  assert.equal(first.final_world.history.archives.length, 10);
  assert.equal(first.final_world.competition.movement_history.length, 16);
  assert.equal(first.final_world.season_number, 3);
  const clubIds = first.final_world.competition.divisions.flatMap((row) => row.club_ids);
  assert.equal(new Set(clubIds).size, 20);
});

test('resumed multi-division batches count only newly added history', () => {
  const firstSeason = advancePersistentLeagueSeason(world()).world;
  const resumed = runPersistentLeagueSeasons({ seasons: 1, world: firstSeason });

  assert.equal(resumed.accepted, true);
  assert.equal(resumed.final_world.history.archives.length, 10);
  assert.equal(resumed.final_world.competition.movement_history.length, 16);
  assert.equal(resumed.final_world.season_number, 3);
  assert.equal(resumed.checks.archives_match_divisions_and_seasons, true);
  assert.equal(resumed.checks.movements_match_boundaries_and_seasons, true);
  assert.equal(resumed.checks.world_advanced_exactly, true);
});

test('rejects swapped canonical division levels and duplicate membership', () => {
  const swapped = structuredClone(world());
  swapped.competition.divisions[0].level = 2;
  swapped.competition.divisions[1].level = 1;
  assert.equal(validatePersistentLeagueWorld(swapped).valid, false);

  const duplicated = structuredClone(world());
  duplicated.competition.divisions[1].club_ids[0] = duplicated.competition.divisions[0].club_ids[0];
  assert.equal(validatePersistentLeagueWorld(duplicated).valid, false);
});
