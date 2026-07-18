import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import {
  executeTacticalResolution,
  resolveTeamTactics,
  TACTICAL_RESOLUTION_STATE_KEY,
  TACTICAL_RESOLUTION_VERSION
} from '../src/matchEngine/modules/TacticalResolution.js';
import { goldenCases, goldenWorld } from './fixtures/matchSimulation-golden-cases.js';

function team(overrides = {}) {
  return {
    side: 'home',
    club_id: 'club-home',
    formation: '4-3-3-wide',
    starting_xi: [],
    bench: [],
    tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
    ...overrides
  };
}

test('resolves formation families, shape weights and explicit tactical choices', () => {
  const resolved = resolveTeamTactics(team({
    formation: '3-5-2',
    tactics: {
      style: 'counter-attacking',
      route_to_goal: 'wide',
      mentality: 'positive',
      pressing: 'mid',
      tempo: 'fast'
    }
  }));

  assert.equal(resolved.version, TACTICAL_RESOLUTION_VERSION);
  assert.deepEqual(resolved.families, {
    defensive_base: 'back_three',
    midfield_base: 'double_pivot',
    attacking_apex: 'two_striker'
  });
  assert.equal(resolved.style, 'counter_transition');
  assert.equal(resolved.style_source, 'manager_instruction');
  assert.equal(resolved.route_to_goal, 'wide');
  assert.equal(resolved.route_source, 'manager_instruction');
  assert.equal(resolved.route_effects.formation_fit, 0.06);
  assert.equal(Object.values(resolved.shape_weights).reduce((sum, value) => sum + value, 0), 1);
  assert.ok(resolved.trade_offs.formation.gain);
  assert.ok(resolved.trade_offs.formation.exposure);
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.trade_offs));
});

test('uses bounded compatibility inference for the current manager contract', () => {
  const attacking = resolveTeamTactics(team({
    tactics: { mentality: 'attacking', pressing: 'high', tempo: 'fast', width: 'wide' }
  }));
  assert.equal(attacking.style, 'high_press');
  assert.equal(attacking.style_source, 'compatibility_inference');
  assert.equal(attacking.route_to_goal, 'wide');
  assert.equal(attacking.route_source, 'compatibility_inference');

  const neutral = resolveTeamTactics(team());
  assert.equal(neutral.style, 'balanced');
  assert.equal(neutral.style_source, 'compatibility_default');
  assert.equal(neutral.route_to_goal, 'balanced');
  assert.equal(neutral.route_source, 'compatibility_default');
  assert.equal(neutral.route_effects.matchup_upside, 0.02);
  assert.equal(neutral.route_effects.robustness, 0.06);
});

test('writes one immutable home-and-away resolution into EngineContext', () => {
  const fixture = goldenCases[1];
  const context = createEngineContext({ contract: fixture.contract, world: goldenWorld });
  const returned = executeTacticalResolution(context);
  const state = context.get(TACTICAL_RESOLUTION_STATE_KEY);

  assert.strictEqual(returned, context);
  assert.equal(state.version, TACTICAL_RESOLUTION_VERSION);
  assert.equal(state.home.style, 'high_press');
  assert.equal(state.away.style, 'low_block');
  assert.equal(state.home.formation, '4-3-3-wide');
  assert.equal(state.away.formation, '4-3-3-wide');
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.home));
  assert.ok(Object.isFrozen(state.away));
});

test('every tactical gain carries an exposure', () => {
  for (const formation of ['4-4-2', '4-3-3-wide', '4-2-3-1', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2']) {
    for (const style of ['possession', 'counter_transition', 'direct', 'high_press', 'low_block', 'balanced']) {
      for (const route of ['central', 'balanced', 'wide']) {
        const resolved = resolveTeamTactics(team({ formation, tactics: { style, route_to_goal: route } }));
        for (const tradeOff of Object.values(resolved.trade_offs)) {
          assert.ok(tradeOff.gain, `${formation}/${style}/${route} is missing a gain`);
          assert.ok(tradeOff.exposure, `${formation}/${style}/${route} is missing an exposure`);
        }
      }
    }
  }
});

test('rejects unsupported formation, style and route values', () => {
  assert.throws(
    () => resolveTeamTactics(team({ formation: '2-2-6' })),
    /Unsupported Module A formation: 2-2-6/
  );
  assert.throws(
    () => resolveTeamTactics(team({ tactics: { style: 'win-button' } })),
    /Unsupported Module A tactical style: win_button/
  );
  assert.throws(
    () => resolveTeamTactics(team({ tactics: { route_to_goal: 'everywhere' } })),
    /Unsupported Module A route to goal: everywhere/
  );
});
