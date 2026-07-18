import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import {
  executePlayerQuality,
  playerAbility,
  resolvePlayerQuality,
  resolveTeamQuality,
  roleSuitability,
  PLAYER_QUALITY_STATE_KEY,
  PLAYER_QUALITY_VERSION
} from '../src/matchEngine/modules/PlayerQuality.js';
import { goldenCases, goldenWorld } from './fixtures/matchSimulation-golden-cases.js';

const positionSet = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const makePlayers = (prefix, rating, form = 0) => positionSet.map((position, index) => ({
  tbg_player_id: `${prefix}-${index + 1}`,
  display_name: `${prefix} ${index + 1}`,
  position,
  underlying_ability_rating: rating,
  form
}));

function team(prefix, formation = '4-3-3-wide', bench = []) {
  return { side: prefix, club_id: `${prefix}-club`, formation, starting_xi: positionSet.map((_, index) => `${prefix}-${index + 1}`), bench };
}

test('reads the canonical Ability field and bounded aliases deterministically', () => {
  assert.equal(playerAbility({ underlying_ability_rating: 91 }), 91);
  assert.equal(playerAbility({ ability: 88 }), 88);
  assert.equal(playerAbility({ rating: 120 }), 100);
  assert.throws(() => playerAbility({ tbg_player_id: 'missing' }), /missing Ability/);
});

test('role suitability rewards natural deployment and penalises misuse', () => {
  const centreBack = { position: 'Centre-Back' };
  assert.equal(roleSuitability(centreBack, 'cb'), 1);
  assert.equal(roleSuitability(centreBack, 'fb'), 0.96);
  assert.equal(roleSuitability(centreBack, 'st'), 0.84);
  assert.equal(roleSuitability(centreBack, 'gk'), 0.72);
});

test('player quality combines Ability, bounded Form and role fit without using Potential or Reputation', () => {
  const natural = resolvePlayerQuality({ tbg_player_id: 'p1', position: 'Centre-Forward', underlying_ability_rating: 90, form: 5, potential: 99, reputation: 100 }, 'st', 9);
  const misplaced = resolvePlayerQuality({ tbg_player_id: 'p1', position: 'Centre-Forward', underlying_ability_rating: 90, form: 5 }, 'cb', 2);
  assert.equal(natural.effective_quality, 93);
  assert.ok(misplaced.effective_quality < natural.effective_quality);
});

test('resolves starting XI, positional units, bench depth and bounded team strength', () => {
  const starters = makePlayers('home', 90);
  const bench = makePlayers('bench', 84).slice(0, 5);
  const lookup = new Map([...starters, ...bench].map((player) => [player.tbg_player_id, player]));
  const resolved = resolveTeamQuality(team('home', '4-3-3-wide', bench.map((player) => player.tbg_player_id)), lookup);

  assert.equal(resolved.version, PLAYER_QUALITY_VERSION);
  assert.equal(resolved.starters.length, 11);
  assert.equal(resolved.units.goalkeeping.player_count, 1);
  assert.equal(resolved.units.defence.player_count, 4);
  assert.equal(resolved.units.midfield.player_count, 3);
  assert.equal(resolved.units.attack.player_count, 3);
  assert.equal(resolved.starting_xi_quality, 90);
  assert.equal(resolved.depth_contribution, -0.9);
  assert.equal(resolved.team_strength, 89.1);
  assert.equal(resolved.rating_inputs.potential, 'excluded from match quality');
  assert.equal(resolved.rating_inputs.reputation, 'excluded from match quality');
  assert.ok(Object.isFrozen(resolved));
});

test('a stronger XI remains stronger while deployment can narrow the gap', () => {
  const strong = makePlayers('strong', 92);
  const weaker = makePlayers('weak', 88);
  const lookup = new Map([...strong, ...weaker].map((player) => [player.tbg_player_id, player]));
  const strongResolved = resolveTeamQuality(team('strong'), lookup);
  const weakResolved = resolveTeamQuality(team('weak'), lookup);
  assert.ok(strongResolved.team_strength > weakResolved.team_strength);

  const misplacedStrong = strong.map((player, index) => ({ ...player, position: index === 0 ? 'Centre-Forward' : player.position }));
  const misplacedLookup = new Map([...misplacedStrong, ...weaker].map((player) => [player.tbg_player_id, player]));
  const narrowed = resolveTeamQuality(team('strong'), misplacedLookup);
  assert.ok(narrowed.team_strength < strongResolved.team_strength);
  assert.ok(narrowed.team_strength > weakResolved.team_strength);
});

test('writes immutable home and away quality state without applying it to public results', () => {
  const fixture = goldenCases[0];
  const context = createEngineContext({ contract: fixture.contract, world: goldenWorld });
  const returned = executePlayerQuality(context);
  const state = context.get(PLAYER_QUALITY_STATE_KEY);
  assert.strictEqual(returned, context);
  assert.equal(state.version, PLAYER_QUALITY_VERSION);
  assert.equal(state.home.team_strength, 90.091);
  assert.equal(state.away.team_strength, 90.091);
  assert.equal(state.applied_to_public_result, false);
  assert.ok(Object.isFrozen(state));
});

test('rejects incomplete lineups and missing players rather than silently inventing quality', () => {
  const players = makePlayers('home', 90);
  const lookup = new Map(players.map((player) => [player.tbg_player_id, player]));
  assert.throws(() => resolveTeamQuality({ ...team('home'), starting_xi: ['home-1'] }, lookup), /must contain 11 players/);
  const missing = team('home'); missing.starting_xi[10] = 'absent';
  assert.throws(() => resolveTeamQuality(missing, lookup), /player not found: absent/);
});
