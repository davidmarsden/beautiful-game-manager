import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateMatch,
  DEFAULT_MATCH_ENGINE_MODE,
  MATCH_ENGINE_MODES
} from '../src/matchSimulation.js';

const POSITIONS = [
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger'
];

function players(prefix, rating) {
  return POSITIONS.map((position, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix}-${index + 1}`,
    position,
    underlying_ability_rating: rating,
    work_rate: 60
  }));
}

function team(side, prefix) {
  return {
    side,
    club_id: prefix,
    club_name: prefix,
    formation: '4-3-3-wide',
    starting_xi: POSITIONS.map((_, index) => `${prefix}-${index + 1}`),
    bench: [],
    tactics: {
      style: 'balanced',
      route_to_goal: 'balanced',
      pressing: 'mid',
      tempo: 'normal',
      mentality: 'balanced'
    }
  };
}

function fixture(overrides = {}) {
  const homePrefix = 'pr54-home';
  const awayPrefix = 'pr54-away';
  return {
    contract: {
      contract_version: '2d2-v1',
      run_key: 'pr54-default-cutover',
      fixture: {
        fixture_id: 'pr54-default-cutover',
        season_id: 'pr54',
        matchday: 1,
        kickoff_at: '2026-07-19T15:00:00.000Z'
      },
      teams: {
        home: team('home', homePrefix),
        away: team('away', awayPrefix)
      },
      ...overrides
    },
    world: {
      players: [...players(homePrefix, 91), ...players(awayPrefix, 91)]
    }
  };
}

test('constitutional-v1 is the exported default engine mode', () => {
  assert.equal(DEFAULT_MATCH_ENGINE_MODE, MATCH_ENGINE_MODES.constitutional);
});

test('an omitted engine mode runs the constitutional public adapter', () => {
  const { contract, world } = fixture();
  const result = simulateMatch(contract, world);

  assert.equal(result.model.simulator, 'tbg-constitutional-engine-a-f');
  assert.equal(result.result_version, '2d5-v1');
});

test('explicit constitutional mode matches the new default', () => {
  const defaultFixture = fixture();
  const explicitFixture = fixture({ engine_mode: MATCH_ENGINE_MODES.constitutional });
  const defaultResult = simulateMatch(defaultFixture.contract, defaultFixture.world);
  const explicitResult = simulateMatch(explicitFixture.contract, explicitFixture.world);

  assert.deepEqual(defaultResult, explicitResult);
});

test('compatibility remains available as an explicit fallback', () => {
  const { contract, world } = fixture({ engine_mode: MATCH_ENGINE_MODES.compatibility });
  const result = simulateMatch(contract, world);

  assert.equal(result.model.simulator, 'tbg-deterministic-bootstrap-rich-events');
  assert.equal(result.result_version, '2d5-v1');
});

test('legacy match_engine_mode can still request compatibility fallback', () => {
  const { contract, world } = fixture({ match_engine_mode: MATCH_ENGINE_MODES.compatibility });
  const result = simulateMatch(contract, world);

  assert.equal(result.model.simulator, 'tbg-deterministic-bootstrap-rich-events');
});
