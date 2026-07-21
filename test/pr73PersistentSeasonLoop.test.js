import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import {
  advancePersistentSeason,
  createPersistentWorld,
  loadPersistentWorld,
  runPersistentWorldSeasons,
  savePersistentWorld,
  validatePersistentWorld
} from '../src/world/persistentSeasonLoop.js';

function world() {
  return createPersistentWorld({
    worldId: 'pr73-world',
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    humanClubId: 'club-1'
  });
}

test('persistent save/load is deterministic and rejects corruption', () => {
  const created = world();
  const saved = savePersistentWorld(created);
  const loaded = loadPersistentWorld(saved);
  assert.deepEqual(loaded, created);
  assert.equal(validatePersistentWorld(loaded).valid, true);

  const envelope = JSON.parse(saved);
  envelope.world.season_number = 99;
  assert.throws(() => loadPersistentWorld(JSON.stringify(envelope)), /checksum mismatch/);
});

test('connects human decisions, autonomous clubs, archive, offseason and rollover', () => {
  const report = advancePersistentSeason(world(), {
    defaultInstruction: {
      formation: '4-3-3-wide',
      tactics: { mentality: 'positive', pressing: 'mid', tempo: 'normal', route_to_goal: 'wide', style: 'possession' }
    }
  });

  assert.equal(report.accepted, true);
  assert.equal(report.season.accepted, true);
  assert.equal(report.season.season_report.accepted, true);
  assert.equal(report.archive.accepted, true);
  assert.equal(report.world.phase, 'preseason');
  assert.equal(report.world.season_number, 2);
  assert.equal(report.world.history.archives.length, 1);
  assert.equal(report.season.decisions.length, report.season.onboarding.required_decisions);
  assert.equal(report.ai_preseason.length, 3);
  assert.equal(report.ai_next_preseason.length, 3);
  assert.equal(report.next_season_viability.every((row) => row.viable), true);
  assert.equal(Object.values(report.checks).every(Boolean), true);
});

test('repeated persistent seasons preserve unique history and viable squads', () => {
  const first = runPersistentWorldSeasons({ seasons: 2, world: world() });
  const second = runPersistentWorldSeasons({ seasons: 2, world: world() });

  assert.equal(first.accepted, true);
  assert.deepEqual(first, second);
  assert.equal(first.final_world.history.archives.length, 2);
  assert.equal(first.final_world.season_number, 3);
  assert.equal(new Set(first.final_world.history.archives.map((row) => row.archive_id)).size, 2);
  assert.equal(first.reports.every((row) => row.checks.final_save_load_equivalent), true);
});

test('load rejects broken ownership references rather than repairing them', () => {
  const created = world();
  const broken = structuredClone(created);
  broken.squad_cycle.clubs['club-1'].player_ids.push('missing-player');
  const validation = validatePersistentWorld(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((row) => row.includes('unknown player')));
  assert.throws(() => savePersistentWorld(broken), /Cannot save invalid world/);
});
