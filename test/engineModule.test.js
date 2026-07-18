import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_MODULE_INTERFACE_VERSION,
  createEngineModule,
  validateEngineModules
} from '../src/matchEngine/EngineModule.js';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import { CONSTITUTIONAL_ENGINE_MODULES } from '../src/matchEngine/modules/index.js';
import { TACTICAL_RESOLUTION_STATE_KEY } from '../src/matchEngine/modules/TacticalResolution.js';
import { PLAYER_QUALITY_STATE_KEY } from '../src/matchEngine/modules/PlayerQuality.js';
import { FATIGUE_CONTEXT_STATE_KEY } from '../src/matchEngine/modules/FatigueContext.js';
import { EVENT_GENERATION_STATE_KEY } from '../src/matchEngine/modules/EventGeneration.js';

const positions = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const ids = (prefix) => positions.map((_, index) => `${prefix}-${index + 1}`);
const homeIds = ids('home');
const awayIds = ids('away');

const contract = {
  run_key: 'module-interface-test',
  fixture: { fixture_id: 'fixture-module-interface' },
  teams: {
    home: {
      side: 'home', club_id: 'home-club', formation: '4-3-3-wide', starting_xi: homeIds, bench: [],
      tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal' }
    },
    away: {
      side: 'away', club_id: 'away-club', formation: '4-3-3-wide', starting_xi: awayIds, bench: [],
      tactics: { mentality: 'cautious', pressing: 'low', tempo: 'slow' }
    }
  }
};

const world = {
  players: [
    ...homeIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 90 })),
    ...awayIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 88 }))
  ]
};

test('defines six ordered constitutional module interfaces', () => {
  assert.equal(CONSTITUTIONAL_ENGINE_MODULES.length, 6);
  assert.deepEqual(CONSTITUTIONAL_ENGINE_MODULES.map((module) => module.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(CONSTITUTIONAL_ENGINE_MODULES.map((module) => module.id), [
    'module-a-tactical-resolution',
    'module-b-team-quality',
    'module-c-fatigue-context',
    'module-d-event-generation',
    'module-e-match-resolution',
    'module-f-commentary-report'
  ]);
  assert.ok(CONSTITUTIONAL_ENGINE_MODULES.every((module) => module.interfaceVersion === ENGINE_MODULE_INTERFACE_VERSION));
  assert.ok(CONSTITUTIONAL_ENGINE_MODULES.every((module) => Object.isFrozen(module)));
});

test('modules preserve the shared EngineContext while live modules write internal state', () => {
  const context = createEngineContext({ contract, world });

  for (const module of CONSTITUTIONAL_ENGINE_MODULES) assert.equal(module.execute(context), context);

  assert.deepEqual(Object.keys(context.state), [
    TACTICAL_RESOLUTION_STATE_KEY,
    PLAYER_QUALITY_STATE_KEY,
    FATIGUE_CONTEXT_STATE_KEY,
    EVENT_GENERATION_STATE_KEY
  ]);
  assert.equal(context.get(TACTICAL_RESOLUTION_STATE_KEY).home.formation, '4-3-3-wide');
  assert.equal(context.get(PLAYER_QUALITY_STATE_KEY).home.team_strength, 90);
  assert.equal(context.get(PLAYER_QUALITY_STATE_KEY).away.team_strength, 88);
  assert.equal(context.get(FATIGUE_CONTEXT_STATE_KEY).home.team.average_fitness, 100);
  assert.equal(context.get(EVENT_GENERATION_STATE_KEY).score_resolution_pending, true);
  assert.ok(context.get(EVENT_GENERATION_STATE_KEY).expected.home.expected_goals > 0);
});

test('module factory rejects incomplete descriptors', () => {
  assert.throws(() => createEngineModule({ name: 'Missing id', order: 1, execute() {} }), /id is required/);
  assert.throws(() => createEngineModule({ id: 'missing-name', order: 1, execute() {} }), /name is required/);
  assert.throws(() => createEngineModule({ id: 'bad-order', name: 'Bad order', order: 0, execute() {} }), /positive integer/);
  assert.throws(() => createEngineModule({ id: 'missing-execute', name: 'Missing execute', order: 1 }), /execute function/);
});

test('module validation rejects duplicate identity and order', () => {
  const first = createEngineModule({ id: 'first', name: 'First', order: 1, execute() {} });
  const duplicateId = createEngineModule({ id: 'first', name: 'Duplicate ID', order: 2, execute() {} });
  const duplicateOrder = createEngineModule({ id: 'second', name: 'Duplicate order', order: 1, execute() {} });

  assert.throws(() => validateEngineModules([first, duplicateId]), /Duplicate engine module id/);
  assert.throws(() => validateEngineModules([first, duplicateOrder]), /Duplicate engine module order/);
});