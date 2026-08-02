import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';

const sidePlayers = (side) => [
  { player_id: `${side}-gk`, required_role: 'gk', actual_role: 'gk', effective_quality: 90 },
  { player_id: `${side}-cb`, required_role: 'cb', actual_role: 'cb', effective_quality: 86 },
  { player_id: `${side}-cm`, required_role: 'cm', actual_role: 'cm', effective_quality: 84 },
  { player_id: `${side}-st`, required_role: 'st', actual_role: 'st', effective_quality: 88 }
];

const contract = {
  teams: {
    home: { starting_xi: sidePlayers('home').map((row) => row.player_id), bench: [] },
    away: { starting_xi: sidePlayers('away').map((row) => row.player_id), bench: [] }
  }
};

const quality = {
  home: { starters: sidePlayers('home'), bench: { players: [] } },
  away: { starters: sidePlayers('away'), bench: { players: [] } }
};

test('goalkeepers are reassigned away from outfield attacking events before finalisation', () => {
  const result = resolveLineupEvents({
    provisional_event_stream: [
      { event_id: 'chance', minute: 12, side: 'home', type: 'big_chance', player_id: 'home-gk' },
      { event_id: 'shot', minute: 13, side: 'home', type: 'shot', player_id: 'home-gk' },
      { event_id: 'goal', minute: 14, side: 'home', type: 'goal', player_id: 'home-gk' }
    ]
  }, contract, quality);

  for (const event of result.events.filter((row) => ['big_chance', 'shot', 'goal'].includes(row.type))) {
    assert.notEqual(event.player_id, 'home-gk');
    assert.equal(event.reassigned_from_player_id, 'home-gk');
    assert.equal(event.actor_reassignment_reason, 'ineligible_role');
  }
});

test('goalkeepers are reassigned away from ordinary fouls and cards', () => {
  const result = resolveLineupEvents({
    provisional_event_stream: [
      { event_id: 'foul', minute: 20, side: 'away', type: 'foul', subtype: 'ordinary_foul', player_id: 'away-gk' },
      { event_id: 'yellow', minute: 21, side: 'away', type: 'yellow_card', player_id: 'away-gk' },
      { event_id: 'red', minute: 22, side: 'away', type: 'red_card', player_id: 'away-gk' }
    ]
  }, contract, quality);

  for (const event of result.events.filter((row) => ['foul', 'yellow_card', 'red_card'].includes(row.type))) {
    assert.notEqual(event.player_id, 'away-gk');
    assert.equal(event.actor_reassignment_reason, 'ineligible_role');
  }
});

test('goalkeeper injuries remain valid goalkeeper events', () => {
  const result = resolveLineupEvents({
    provisional_event_stream: [
      { event_id: 'injury', minute: 30, side: 'home', type: 'injury', player_id: 'home-gk' }
    ]
  }, contract, quality);

  const injury = result.events.find((event) => event.event_id === 'injury');
  assert.equal(injury.player_id, 'home-gk');
  assert.equal(injury.reassigned_from_player_id, undefined);
});

test('inactive actors are still repaired using an eligible active player', () => {
  const result = resolveLineupEvents({
    provisional_event_stream: [
      { event_id: 'inactive-shot', minute: 10, side: 'home', type: 'shot', player_id: 'home-bench-player' }
    ]
  }, contract, quality);

  const event = result.events.find((row) => row.event_id === 'inactive-shot');
  assert.ok(event.player_id);
  assert.notEqual(event.player_id, 'home-gk');
  assert.equal(event.actor_reassignment_reason, 'inactive_actor');
});
