import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/matchSimulation.js';

const players = Array.from({ length: 22 }, (_, index) => ({
  tbg_player_id: `p${index + 1}`,
  display_name: `Player ${index + 1}`,
  underlying_ability_rating: 88 + (index % 6),
  position: index % 11 === 0 ? 'Goalkeeper' : index % 4 === 0 ? 'Centre-Forward' : index % 3 === 0 ? 'Central Midfield' : 'Centre-Back'
}));

const contract = {
  run_key: 'world:fixture-rich-events-test',
  fixture: { fixture_id: 'fixture-rich-events-test' },
  teams: {
    home: { starting_xi: players.slice(0, 11).map((p) => p.tbg_player_id), tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal' } },
    away: { starting_xi: players.slice(11).map((p) => p.tbg_player_id), tactics: { mentality: 'positive', pressing: 'high', tempo: 'fast' } }
  }
};

const world = { players };

const goalkeeperIds = new Set(players.filter((player) => player.position === 'Goalkeeper').map((player) => player.tbg_player_id));
const outfieldActorEvents = new Set(['goal', 'shot_saved', 'shot_missed', 'shot_blocked', 'corner', 'foul', 'yellow_card', 'red_card', 'offside', 'tackle', 'dangerous_attack']);

test('rich event simulation is deterministic and coherent', () => {
  const first = simulateMatch(contract, world);
  const second = simulateMatch(contract, world);
  assert.deepEqual(first.score, second.score);
  assert.deepEqual(first.events, second.events);
  assert.equal(first.result_version, '2d5-v1');
  assert.ok(first.events.length >= 25);
  assert.ok(first.events.every((event) => typeof event.commentary === 'string' && event.commentary.length > 0));
  assert.ok(first.events.some((event) => event.type === 'shot_saved'));
  assert.ok(first.events.some((event) => event.type === 'shot_missed'));
  assert.ok(first.events.some((event) => event.type === 'foul'));
  assert.ok(first.events.some((event) => event.type === 'tackle'));
  assert.ok(first.events.some((event) => event.type === 'yellow_card'));
  assert.ok(first.events.some((event) => event.type === 'half_time'));
  assert.ok(first.events.some((event) => event.type === 'full_time'));
  assert.equal(first.events.filter((event) => event.type === 'goal' && event.side === 'home').length, first.score.home);
  assert.equal(first.events.filter((event) => event.type === 'goal' && event.side === 'away').length, first.score.away);
  assert.deepEqual([...first.events].sort((a, b) => a.minute - b.minute), first.events);

  for (const event of first.events.filter((row) => outfieldActorEvents.has(row.type))) {
    assert.ok(!goalkeeperIds.has(event.player_id), `${event.type} incorrectly selected goalkeeper ${event.player_id}`);
  }

  for (const event of first.events.filter((row) => row.type === 'shot_saved')) {
    assert.ok(goalkeeperIds.has(event.opponent_id), `shot_saved did not select a goalkeeper opponent: ${event.opponent_id}`);
  }
});
