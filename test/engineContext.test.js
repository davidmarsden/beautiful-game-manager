import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEngineContext,
  EngineContext,
  ENGINE_CONTEXT_VERSION
} from '../src/matchEngine/EngineContext.js';

const contract = {
  run_key: 'engine-context-test-run',
  fixture: { fixture_id: 'engine-context-test-fixture' },
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

test('creates a versioned context from the existing engine inputs', () => {
  const context = createEngineContext({ contract, world });

  assert.ok(context instanceof EngineContext);
  assert.equal(context.version, ENGINE_CONTEXT_VERSION);
  assert.equal(context.contract, contract);
  assert.equal(context.world, world);
  assert.equal(context.runKey, contract.run_key);
  assert.equal(context.fixture, contract.fixture);
  assert.equal(context.teams, contract.teams);
  assert.equal(context.getPlayer('home-1').display_name, 'Home Player');
});

test('provides isolated working state without mutating the input contract', () => {
  const first = createEngineContext({ contract, world });
  const second = createEngineContext({ contract, world });

  first.set('quality_gap', 0.25);

  assert.equal(first.get('quality_gap'), 0.25);
  assert.equal(second.get('quality_gap'), undefined);
  assert.equal(contract.quality_gap, undefined);
});

test('retains the existing incomplete-contract validation error', () => {
  assert.throws(
    () => createEngineContext({ contract: {}, world }),
    { message: 'A complete engine contract is required' }
  );
});
