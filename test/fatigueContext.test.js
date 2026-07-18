import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import { executeTacticalResolution } from '../src/matchEngine/modules/TacticalResolution.js';
import { executePlayerQuality } from '../src/matchEngine/modules/PlayerQuality.js';
import {
  executeFatigueContext,
  fitnessModifier,
  resolvePlayerContext,
  resolveTeamContext,
  FATIGUE_CONTEXT_STATE_KEY,
  FATIGUE_CONTEXT_VERSION
} from '../src/matchEngine/modules/FatigueContext.js';

const positions = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const ids = (prefix) => positions.map((_, index) => `${prefix}-${index + 1}`);
const makePlayers = (prefix, fitness = 100) => positions.map((position, index) => ({
  tbg_player_id: `${prefix}-${index + 1}`,
  display_name: `${prefix} ${index + 1}`,
  position,
  underlying_ability_rating: 90,
  fitness,
  sharpness: 100,
  morale: 50,
  work_rate_rating: 50
}));

function team(prefix, overrides = {}) {
  return {
    side: prefix,
    club_id: `${prefix}-club`,
    formation: '4-3-3-wide',
    starting_xi: ids(prefix),
    bench: [],
    tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal', width: 'balanced' },
    ...overrides
  };
}

function lookup(players) {
  return new Map(players.map((player) => [player.tbg_player_id, player]));
}

test('fitness gates mean contribution without becoming a positive bonus', () => {
  assert.equal(fitnessModifier(100), 1);
  assert.equal(fitnessModifier(90), 1);
  assert.ok(fitnessModifier(70) < 1);
  assert.ok(fitnessModifier(40) < fitnessModifier(70));
  assert.equal(fitnessModifier(0), 0.6);
});

test('pressing, tempo, role and work rate produce transparent workload costs', () => {
  const player = { tbg_player_id: 'p1', fitness: 100, sharpness: 100, morale: 50, work_rate_rating: 80 };
  const low = resolvePlayerContext(player, { tactics: { pressing: 'low', tempo: 'slow' } }, 'gk', {});
  const high = resolvePlayerContext(player, { tactics: { pressing: 'high', tempo: 'fast' } }, 'wing_back', {});

  assert.ok(high.workload_multiplier > low.workload_multiplier);
  assert.ok(high.projected_match_cost_90 > low.projected_match_cost_90);
  assert.ok(high.projected_post_match_fitness_90 < low.projected_post_match_fitness_90);
});

test('injury risk is fatigue-driven rather than an unbounded lottery', () => {
  const fresh = resolvePlayerContext({ tbg_player_id: 'fresh', fitness: 100 }, { tactics: { pressing: 'mid', tempo: 'normal' } }, 'cm', {});
  const tired = resolvePlayerContext({ tbg_player_id: 'tired', fitness: 35 }, { tactics: { pressing: 'high', tempo: 'fast' } }, 'cm', {});

  assert.ok(tired.injury_risk_90 > fresh.injury_risk_90);
  assert.ok(fresh.injury_risk_90 >= 0.002);
  assert.ok(tired.injury_risk_90 <= 0.08);
});

test('rotation costs cohesion while familiarity supplies a smaller cushion', () => {
  const players = makePlayers('home');
  const current = team('home');
  const previous = [...current.starting_xi];
  const rotatedPrevious = [...previous.slice(0, 5), ...Array.from({ length: 6 }, (_, index) => `old-${index}`)];
  const packageKey = '4-3-3-wide|balanced|balanced';

  const settled = resolveTeamContext(current, lookup(players), {
    match_state: { clubs: { 'home-club': { cohesion: 80, previous_starting_xi: previous, tactical_familiarity: { [packageKey]: 85 } } } }
  });
  const rotated = resolveTeamContext(current, lookup(players), {
    match_state: { clubs: { 'home-club': { cohesion: 80, previous_starting_xi: rotatedPrevious, tactical_familiarity: { [packageKey]: 85 } } } }
  });

  assert.equal(settled.rotation.continuity, 1);
  assert.ok(rotated.rotation.continuity < settled.rotation.continuity);
  assert.ok(rotated.cohesion.score < settled.cohesion.score);
  assert.ok(rotated.familiarity.narrowing > 0);
  assert.ok(rotated.variance.total_narrowing > rotated.cohesion.narrowing * 0.8);
});

test('familiarity grows reliability mainly through narrowing, with only a tight mean band', () => {
  const players = makePlayers('home');
  const packageKey = '4-3-3-wide|balanced|balanced';
  const low = resolveTeamContext(team('home'), lookup(players), {
    match_state: { clubs: { 'home-club': { cohesion: 50, tactical_familiarity: { [packageKey]: 10 } } } }
  });
  const high = resolveTeamContext(team('home'), lookup(players), {
    match_state: { clubs: { 'home-club': { cohesion: 50, tactical_familiarity: { [packageKey]: 90 } } } }
  });

  assert.ok(high.familiarity.narrowing > low.familiarity.narrowing);
  assert.ok(high.variance.dispersion_multiplier < low.variance.dispersion_multiplier);
  assert.ok(high.familiarity.mean_modifier <= 1.02);
  assert.ok(low.familiarity.mean_modifier >= 0.98);
});

test('Module C writes immutable home and away context without changing public results', () => {
  const players = [...makePlayers('home', 82), ...makePlayers('away', 96)];
  const contract = {
    run_key: 'fatigue-context-test',
    fixture: { fixture_id: 'fixture-fatigue-context' },
    teams: {
      home: team('home', { tactics: { mentality: 'attacking', pressing: 'high', tempo: 'fast', width: 'wide' } }),
      away: team('away', { tactics: { mentality: 'cautious', pressing: 'low', tempo: 'slow', width: 'narrow' } })
    }
  };
  const context = createEngineContext({ contract, world: { players } });
  executeTacticalResolution(context);
  executePlayerQuality(context);
  const returned = executeFatigueContext(context);
  const state = context.get(FATIGUE_CONTEXT_STATE_KEY);

  assert.strictEqual(returned, context);
  assert.equal(state.version, FATIGUE_CONTEXT_VERSION);
  assert.ok(state.home.team.average_workload > state.away.team.average_workload);
  assert.ok(state.home.team.fitness_modifier < state.away.team.fitness_modifier);
  assert.equal(state.state_updates_projected_only, true);
  assert.equal(state.applied_to_public_result, false);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.home.players));
});

test('Module C rejects incomplete lineups and missing players', () => {
  const players = makePlayers('home');
  assert.throws(() => resolveTeamContext({ ...team('home'), starting_xi: ['home-1'] }, lookup(players), {}), /must contain 11 players/);
  const missing = team('home');
  missing.starting_xi[10] = 'absent';
  assert.throws(() => resolveTeamContext(missing, lookup(players), {}), /player not found: absent/);
});