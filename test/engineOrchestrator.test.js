import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineModule } from '../src/matchEngine/EngineModule.js';
import {
  ENGINE_ORCHESTRATOR_VERSION,
  createEngineOrchestrator,
  runEnginePipeline
} from '../src/matchEngine/EngineOrchestrator.js';

const contract = {
  run_key: 'run-orchestrator-test',
  fixture: { fixture_id: 'fixture-orchestrator-test' },
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

function module(id, order, calls) {
  return createEngineModule({
    id,
    name: id,
    order,
    execute(context) {
      calls.push(id);
      context.set(id, true);
      return context;
    }
  });
}

test('runs modules in validated A-F order before the compatibility runner', () => {
  const calls = [];
  const modules = [module('module-c', 3, calls), module('module-a', 1, calls), module('module-b', 2, calls)];

  const result = runEnginePipeline({
    contract,
    world,
    modules,
    compatibilityRunner(context) {
      calls.push('compatibility');
      assert.equal(context.get('module-a'), true);
      assert.equal(context.get('module-b'), true);
      assert.equal(context.get('module-c'), true);
      return { status: 'completed', fixture_id: context.fixture.fixture_id };
    }
  });

  assert.deepEqual(calls, ['module-a', 'module-b', 'module-c', 'compatibility']);
  assert.deepEqual(result, { status: 'completed', fixture_id: 'fixture-orchestrator-test' });
});

test('records an internal immutable execution trace without changing the public result', () => {
  const calls = [];
  let capturedContext;
  const orchestrator = createEngineOrchestrator({
    modules: [module('module-a', 1, calls), module('module-b', 2, calls)],
    compatibilityRunner(context) {
      capturedContext = context;
      return { result_version: 'test-v1' };
    }
  });

  assert.equal(orchestrator.version, ENGINE_ORCHESTRATOR_VERSION);
  const result = orchestrator.run({
    contract,
    world,
    fixture: contract.fixture,
    teams: contract.teams,
    state: Object.create(null),
    set(key, value) { this.state[key] = value; return value; },
    get(key) { return this.state[key]; }
  });

  assert.deepEqual(result, { result_version: 'test-v1' });
  assert.deepEqual(capturedContext.get('orchestration'), {
    version: ENGINE_ORCHESTRATOR_VERSION,
    modules: [
      { id: 'module-a', order: 1 },
      { id: 'module-b', order: 2 }
    ]
  });
  assert.equal(Object.isFrozen(capturedContext.get('orchestration')), true);
  assert.equal(Object.isFrozen(capturedContext.get('orchestration').modules), true);
});

test('rejects modules that replace the shared context', () => {
  const badModule = createEngineModule({
    id: 'bad-module',
    name: 'Bad module',
    order: 1,
    execute: () => ({})
  });
  const orchestrator = createEngineOrchestrator({ modules: [badModule], compatibilityRunner: () => ({}) });

  assert.throws(
    () => orchestrator.run({ contract, fixture: contract.fixture, teams: contract.teams }),
    /must return the shared EngineContext: bad-module/
  );
});

test('requires a compatibility runner and a result object', () => {
  const calls = [];
  const modules = [module('module-a', 1, calls)];
  assert.throws(() => createEngineOrchestrator({ modules }), /compatibility runner is required/);

  const orchestrator = createEngineOrchestrator({ modules, compatibilityRunner: () => null });
  assert.throws(
    () => orchestrator.run({ contract, fixture: contract.fixture, teams: contract.teams, set() {} }),
    /must return a result object/
  );
});
