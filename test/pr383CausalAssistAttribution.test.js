import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';

const contract = {
  teams: {
    home: { bench: [] },
    away: { bench: [] }
  }
};

const quality = {
  home: {
    starters: [
      { player_id: 'h-gk', required_role: 'gk', effective_quality: 90 },
      { player_id: 'h-cm', required_role: 'cm', effective_quality: 91 },
      { player_id: 'h-am', required_role: 'am', effective_quality: 93 },
      { player_id: 'h-wing', required_role: 'wing', effective_quality: 92 },
      { player_id: 'h-st', required_role: 'st', effective_quality: 94 }
    ]
  },
  away: {
    starters: [
      { player_id: 'a-gk', required_role: 'gk', effective_quality: 89 },
      { player_id: 'a-cb', required_role: 'cb', effective_quality: 90 }
    ]
  }
};

function generated(events) {
  return { provisional_event_stream: events };
}

test('open-play goals deterministically attribute assists to active attacking teammates', () => {
  const goals = Array.from({ length: 40 }, (_, index) => ({
    event_id: `open-play-goal-${index + 1}`,
    minute: 1 + index * 2,
    side: 'home',
    type: 'goal',
    subtype: 'open_play_goal',
    player_id: 'h-st',
    source_event_id: `attempt-${index + 1}`,
    provisional: true
  }));

  const first = resolveLineupEvents(generated(goals), contract, quality);
  const second = resolveLineupEvents(generated(goals), contract, quality);
  const assisted = first.events.filter((event) => event.type === 'goal' && event.assist_player_id);

  assert.ok(assisted.length > 0, 'the model should produce assisted goals rather than a permanent zero-assist world');
  assert.ok(assisted.length < goals.length, 'some open-play goals should remain unassisted');
  assert.deepEqual(first.events, second.events, 'same events and players must reproduce the same assist attribution');
  for (const goal of assisted) {
    assert.notEqual(goal.assist_player_id, goal.player_id, 'a scorer cannot assist their own goal');
    assert.notEqual(goal.assist_player_id, 'h-gk', 'goalkeepers are excluded from the normal assist pool');
    assert.ok(['h-cm', 'h-am', 'h-wing'].includes(goal.assist_player_id));
    assert.equal(goal.assist_source, 'causal_active_teammate');
  }
});

test('penalties and own goals never invent assists', () => {
  const result = resolveLineupEvents(generated([
    { event_id: 'penalty-goal', minute: 20, side: 'home', type: 'goal', subtype: 'penalty_goal', player_id: 'h-st', provisional: true },
    { event_id: 'own-goal', minute: 30, side: 'home', type: 'goal', subtype: 'own_goal', player_id: 'h-st', own_goal: true, own_goal_player_id: 'a-cb', provisional: true }
  ]), contract, quality);

  for (const goal of result.events.filter((event) => event.type === 'goal')) {
    assert.equal(goal.assist_player_id, undefined);
  }
});

test('assist attribution follows the on-pitch lineup after substitutions', () => {
  const substitutionContract = {
    teams: {
      home: { bench: ['h-sub'] },
      away: { bench: [] }
    }
  };
  const substitutionQuality = {
    home: {
      starters: [
        { player_id: 'h-gk', required_role: 'gk', effective_quality: 90 },
        { player_id: 'h-cm', required_role: 'cm', effective_quality: 40 },
        { player_id: 'h-am', required_role: 'am', effective_quality: 93 },
        { player_id: 'h-wing', required_role: 'wing', effective_quality: 92 },
        { player_id: 'h-st', required_role: 'st', effective_quality: 94 }
      ],
      bench: { players: [{ player_id: 'h-sub', required_role: 'cm', actual_role: 'cm', effective_quality: 88 }] }
    },
    away: quality.away
  };
  const lateGoals = Array.from({ length: 20 }, (_, index) => ({
    event_id: `late-open-play-goal-${index + 1}`,
    minute: 61 + index,
    side: 'home',
    type: 'goal',
    subtype: 'open_play_goal',
    player_id: 'h-st',
    source_event_id: `late-attempt-${index + 1}`,
    provisional: true
  }));

  const result = resolveLineupEvents(generated(lateGoals), substitutionContract, substitutionQuality);
  const substitution = result.events.find((event) => event.type === 'substitution' && event.minute === 60);
  const assisted = result.events.filter((event) => event.type === 'goal' && event.assist_player_id);

  assert.ok(substitution);
  assert.equal(substitution.player_out_id, 'h-cm');
  assert.equal(substitution.player_in_id, 'h-sub');
  assert.ok(assisted.length > 0);
  for (const goal of assisted) {
    assert.notEqual(goal.assist_player_id, 'h-cm', 'a substituted player cannot assist a later goal');
    assert.ok(['h-am', 'h-wing', 'h-sub'].includes(goal.assist_player_id));
  }
});
