import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_MODULE_INTERFACE_VERSION,
  createEngineModule,
  validateEngineModules
} from '../src/matchEngine/EngineModule.js';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import { CONSTITUTIONAL_ENGINE_MODULES } from '../src/matchEngine/modules/index.js';

const contract = {
  run_key: 'module-interface-test',
  fixture: { fixture_id: 'fixture-module-interface' },
  teams: {
    home: { starting_xi: ['home-1'] },
    away: { starting_xi: ['away-1'] }
  }
};

const world = {
  players: [
    { tbg_player_id: 'home-1', display_name: 'Home Player' },
    { tbg_player_id: 'away-1', display_name: 'Away Player' }
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

test('placeholder modules accept and return the shared EngineContext without mutation', () => {
  const context = createEngineContext({ contract, world });

  for (const module of CONSTITUTIONAL_ENGINE_MODULES) {
    assert.equal(module.execute(context), context);
  }

  assert.deepEqual(Object.keys(context.state), []);
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
