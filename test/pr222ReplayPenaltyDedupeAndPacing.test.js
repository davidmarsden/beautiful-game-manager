import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decorateMatchCentrePayload,
  replayPresentationForEvent
} from '../netlify/functions/match-centre-linked.mjs';

test('duplicate canonical representations of one scored penalty project once', () => {
  const archived = {
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [
      { minute: 26, side: 'away', event_type: 'penalty_scored', player_id: 'p9', player_name: 'Penalty Taker', commentary: 'Penalty Taker scores from the penalty spot.' },
      { minute: 26, side: 'away', event_type: 'penalty_scored', player_id: 'p9', player_name: 'Penalty Taker', commentary: 'Penalty Taker converts the penalty.' },
      { minute: 74, side: 'away', event_type: 'goal', player_id: 'p10', player_name: 'Other Scorer' }
    ],
    submissions: [],
    summary: {
      scorers: {
        home: [],
        away: [
          { minute: 26, player_id: 'p9', player_name: 'Penalty Taker', penalty: true },
          { minute: 26, player_id: 'p9', player_name: 'Penalty Taker', penalty: true },
          { minute: 74, player_id: 'p10', player_name: 'Other Scorer', penalty: false }
        ]
      },
      cards: { home: [], away: [] },
      top_ratings: []
    },
    player_performances: { home: [], away: [] }
  };

  const projected = decorateMatchCentrePayload(archived, null);
  assert.equal(projected.events.filter((event) => event.event_type === 'penalty_scored').length, 1);
  assert.equal(projected.summary.scorers.away.filter((row) => row.penalty).length, 1);
  assert.equal(projected.summary.scorers.away.length, 2);
});

test('separate penalties remain separate when minute or taker differs', () => {
  const archived = {
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [
      { minute: 26, side: 'away', event_type: 'penalty_scored', player_id: 'p9', player_name: 'Penalty Taker' },
      { minute: 61, side: 'away', event_type: 'penalty_scored', player_id: 'p9', player_name: 'Penalty Taker' },
      { minute: 61, side: 'home', event_type: 'penalty_scored', player_id: 'p11', player_name: 'Home Taker' }
    ],
    submissions: [],
    summary: { scorers: { home: [], away: [] }, cards: { home: [], away: [] }, top_ratings: [] },
    player_performances: { home: [], away: [] }
  };

  const projected = decorateMatchCentrePayload(archived, null);
  assert.equal(projected.events.length, 3);
});

test('featured events now pause briefly while goals retain the longest hold', () => {
  const featuredTypes = ['yellow_card', 'free_kick', 'save', 'injury', 'substitution'];
  for (const type of featuredTypes) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.importance, 'featured');
    assert.equal(presentation.major, true, `${type} should enter the existing replay hold pipeline`);
    assert.ok(presentation.hold_ms >= 1000, `${type} should remain visible long enough to register`);
    assert.ok(presentation.hold_ms < 2000, `${type} should remain shorter than a major match moment`);
  }

  const goal = replayPresentationForEvent({ event_type: 'goal' });
  const penalty = replayPresentationForEvent({ event_type: 'penalty_awarded' });
  assert.ok(goal.hold_ms >= 3200);
  assert.ok(goal.hold_ms > penalty.hold_ms);
  assert.ok(goal.hold_ms > replayPresentationForEvent({ event_type: 'injury' }).hold_ms);
});
