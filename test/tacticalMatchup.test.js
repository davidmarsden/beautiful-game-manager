import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import {
  executeTacticalResolution,
  resolveTeamTactics,
  resolveTacticalMatchup,
  TACTICAL_MATCHUP_VERSION,
  TACTICAL_RESOLUTION_STATE_KEY
} from '../src/matchEngine/modules/TacticalResolution.js';
import { goldenCases, goldenWorld } from './fixtures/matchSimulation-golden-cases.js';

function resolved({ formation = '4-3-3-wide', style = 'balanced', route = 'balanced' } = {}) {
  return resolveTeamTactics({
    side: 'home',
    club_id: 'club',
    formation,
    starting_xi: [],
    bench: [],
    tactics: { style, route_to_goal: route }
  });
}

test('resolves five legible tactical matchup axes and a bounded net advantage', () => {
  const home = resolved({ formation: '4-1-4-1', style: 'possession', route: 'central' });
  const away = resolved({ formation: '3-4-3', style: 'counter_transition', route: 'wide' });
  const matchup = resolveTacticalMatchup(home, away);

  assert.equal(matchup.version, TACTICAL_MATCHUP_VERSION);
  assert.deepEqual(Object.keys(matchup.home.axes), [
    'midfield_control',
    'style',
    'route',
    'transition',
    'pressing'
  ]);
  assert.ok(matchup.home.advantage >= -0.15 && matchup.home.advantage <= 0.15);
  assert.ok(matchup.away.advantage >= -0.15 && matchup.away.advantage <= 0.15);
  assert.equal(matchup.net.home_advantage + matchup.net.away_advantage, 0);
  assert.equal(matchup.applied_to_public_result, false);
  assert.ok(Object.isFrozen(matchup));
  assert.ok(Object.isFrozen(matchup.home.axes));
});

test('counter-transition exploits possession and high-press risk', () => {
  const possession = resolved({ style: 'possession', route: 'central' });
  const counter = resolved({ style: 'counter_transition', route: 'wide' });
  const matchup = resolveTacticalMatchup(counter, possession);

  assert.ok(matchup.home.axes.style > 0);
  assert.ok(matchup.home.axes.transition > 0);
  assert.ok(matchup.net.home_advantage > 0);
});

test('route interaction rewards the right space and resists a packed centre', () => {
  const central = resolved({ formation: '4-1-4-1', style: 'possession', route: 'central' });
  const wide = resolved({ formation: '3-5-2', style: 'possession', route: 'wide' });
  const packedCentre = resolved({ formation: '5-3-2', style: 'low_block', route: 'balanced' });

  const centralAgainstPacked = resolveTacticalMatchup(central, packedCentre);
  const wideAgainstPacked = resolveTacticalMatchup(wide, packedCentre);

  assert.ok(wideAgainstPacked.home.axes.route > centralAgainstPacked.home.axes.route);
});

test('balanced route is robust but cannot produce the highest route upside', () => {
  const opponent = resolved({ formation: '3-4-3', style: 'balanced', route: 'balanced' });
  const balanced = resolveTacticalMatchup(resolved({ formation: '4-2-3-1', route: 'balanced' }), opponent);
  const wide = resolveTacticalMatchup(resolved({ formation: '4-3-3-wide', route: 'wide' }), opponent);

  assert.ok(balanced.home.axes.route >= 0);
  assert.ok(balanced.home.axes.route < wide.home.axes.route);
});

test('high press gains pressure but carries a countervailing exposure', () => {
  const press = resolved({ style: 'high_press', route: 'wide' });
  const direct = resolved({ style: 'direct', route: 'wide' });
  const matchup = resolveTacticalMatchup(press, direct);

  assert.ok(matchup.home.exposure > -matchup.home.advantage);
  assert.ok(matchup.home.axes.pressing <= 0);
});

test('Module A stores tactical matchup without changing the compatibility result path', () => {
  const fixture = goldenCases[1];
  const context = createEngineContext({ contract: fixture.contract, world: goldenWorld });
  executeTacticalResolution(context);
  const state = context.get(TACTICAL_RESOLUTION_STATE_KEY);

  assert.equal(state.matchup.version, TACTICAL_MATCHUP_VERSION);
  assert.equal(state.matchup.applied_to_public_result, false);
  assert.ok(Object.isFrozen(state.matchup));
});

test('no supported tactical combination escapes the constitutional bounds', () => {
  const formations = ['4-4-2', '4-3-3-wide', '4-2-3-1', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2'];
  const styles = ['possession', 'counter_transition', 'direct', 'high_press', 'low_block', 'balanced'];
  const routes = ['central', 'balanced', 'wide'];

  for (const homeFormation of formations) {
    for (const awayFormation of formations) {
      for (const homeStyle of styles) {
        for (const awayStyle of styles) {
          for (const homeRoute of routes) {
            for (const awayRoute of routes) {
              const matchup = resolveTacticalMatchup(
                resolved({ formation: homeFormation, style: homeStyle, route: homeRoute }),
                resolved({ formation: awayFormation, style: awayStyle, route: awayRoute })
              );
              assert.ok(Math.abs(matchup.net.home_advantage) <= 0.15);
              assert.equal(matchup.net.home_advantage + matchup.net.away_advantage, 0);
            }
          }
        }
      }
    }
  }
});
