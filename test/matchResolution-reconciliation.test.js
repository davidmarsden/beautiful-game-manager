import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMatch } from '../src/matchEngine/modules/MatchResolution.js';

function eventGeneration(events, expected = {}) {
  return {
    seed_commitment: 'reconciliation-test',
    provisional_event_stream: events,
    expected: {
      home: { expected_goals: 2.4, ...expected.home },
      away: { expected_goals: 1.7, ...expected.away }
    }
  };
}

test('derives reported expected goals from accepted official shot events', () => {
  const result = resolveMatch(eventGeneration([
    { event_id: 'home-shot-1', minute: 10, side: 'home', type: 'shot', xg: 0.12, on_target: false },
    { event_id: 'home-goal-1', minute: 25, side: 'home', type: 'goal', xg: 0.31, on_target: true, outcome: 'goal' },
    { event_id: 'away-shot-1', minute: 42, side: 'away', type: 'big_chance', xg: 0.24, on_target: true }
  ]));

  assert.equal(result.statistics.home.expected_goals, 0.43);
  assert.equal(result.statistics.home.generated_xg, 0.43);
  assert.equal(result.statistics.home.model_expected_goals, 2.4);
  assert.equal(result.statistics.away.expected_goals, 0.24);
  assert.equal(result.statistics.away.model_expected_goals, 1.7);
  assert.equal(result.consistency.expected_goals_derived_from_official_shots, true);
});

test('counts a second-yellow dismissal in red-card totals and disciplinary state', () => {
  const result = resolveMatch(eventGeneration([
    { event_id: 'yellow-1', minute: 18, side: 'home', type: 'yellow_card', player_id: 'home-6' },
    { event_id: 'yellow-2', minute: 71, side: 'home', type: 'yellow_card', player_id: 'home-6' },
    { event_id: 'straight-red', minute: 80, side: 'away', type: 'red_card', player_id: 'away-4' }
  ]));

  assert.equal(result.statistics.home.yellow_cards, 2);
  assert.equal(result.statistics.home.red_cards, 1);
  assert.equal(result.statistics.home.straight_red_cards, 0);
  assert.equal(result.statistics.home.second_yellow_dismissals, 1);
  assert.equal(result.statistics.away.red_cards, 1);
  assert.equal(result.statistics.away.straight_red_cards, 1);
  assert.equal(result.statistics.away.second_yellow_dismissals, 0);

  const homeDiscipline = result.state_changes.discipline.find((row) => row.player_id === 'home-6');
  assert.equal(homeDiscipline.sent_off, true);
  assert.equal(homeDiscipline.dismissal_type, 'second_yellow');
  assert.equal(result.consistency.dismissals_reconciled, true);
});

test('does not double-count a player with two yellows and an explicit red event', () => {
  const result = resolveMatch(eventGeneration([
    { event_id: 'yellow-1', minute: 18, side: 'home', type: 'yellow_card', player_id: 'home-6' },
    { event_id: 'yellow-2', minute: 70, side: 'home', type: 'yellow_card', player_id: 'home-6' },
    { event_id: 'red-1', minute: 71, side: 'home', type: 'red_card', player_id: 'home-6' }
  ]));

  assert.equal(result.statistics.home.red_cards, 1);
  assert.equal(result.statistics.home.straight_red_cards, 1);
  assert.equal(result.statistics.home.second_yellow_dismissals, 0);
});
