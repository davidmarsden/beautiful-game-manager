import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPenaltyIncident } from '../src/matchEngine/modules/EventGeneration.js';
import { resolveMatch } from '../src/matchEngine/modules/MatchResolution.js';
import { publicEventId } from '../src/matchEngine/constitutionalPublicResult.js';

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1];
}

test('scored penalty creates a separate linked goal event', () => {
  const events = buildPenaltyIncident({
    attackingSide: 'home',
    defendingSide: 'away',
    minute: 37,
    index: 1,
    taker: { player_id: 'home-9' },
    offender: { player_id: 'away-4' },
    random: sequence([0.2])
  });
  assert.equal(events.length, 4);
  const [foul, award, attempt, goal] = events;
  assert.equal(foul.type, 'foul');
  assert.equal(foul.subtype, 'penalty_foul');
  assert.equal(foul.linked_event_id, award.event_id);
  assert.equal(award.source_event_id, foul.event_id);
  assert.equal(award.linked_event_id, attempt.event_id);
  assert.equal(attempt.parent_event_id, award.event_id);
  assert.equal(attempt.source_event_id, foul.event_id);
  assert.equal(attempt.outcome, 'goal');
  assert.equal(attempt.linked_event_id, goal.event_id);
  assert.equal(goal.type, 'goal');
  assert.equal(goal.subtype, 'penalty_goal');
  assert.equal(goal.source_event_id, attempt.event_id);
});

test('Module E scores only the linked goal event and reconciles penalty xG', () => {
  const penalty = buildPenaltyIncident({
    attackingSide: 'home', defendingSide: 'away', minute: 37, index: 1,
    taker: { player_id: 'home-9' }, offender: { player_id: 'away-4' }, random: sequence([0.2])
  });
  const result = resolveMatch({
    provisional_event_stream: [
      { event_id: 'home-foul-1', minute: 10, side: 'home', against_side: 'away', type: 'foul', subtype: 'ordinary_foul' },
      ...penalty
    ],
    expected: { home: { expected_goals: 1.1 }, away: { expected_goals: 0.8 } }
  });
  assert.deepEqual(result.score, { home: 1, away: 0 });
  assert.equal(result.statistics.home.goals, 1);
  assert.equal(result.statistics.home.shots, 1);
  assert.equal(result.statistics.home.penalties_awarded, 1);
  assert.equal(result.statistics.home.penalties_taken, 1);
  assert.equal(result.statistics.home.penalties_scored, 1);
  assert.equal(result.statistics.home.expected_goals, 0.76);
  assert.equal(result.statistics.home.fouls_committed, 1);
  assert.equal(result.statistics.away.fouls_committed, 1);
  assert.equal(result.statistics.home.fouls_won, 1);
  assert.equal(result.consistency.linked_penalties_reconciled, true);
  assert.equal(result.consistency.score_changes_are_goal_events, true);
});

test('retaken penalty links attempts and only terminal attempt affects statistics', () => {
  const events = buildPenaltyIncident({
    attackingSide: 'home', defendingSide: 'away', minute: 50, index: 1,
    taker: { player_id: 'home-9' }, offender: { player_id: 'away-4' },
    random: sequence([0.001, 0.2])
  });
  const attempts = events.filter((event) => event.type === 'penalty' && event.subtype === 'penalty_attempt');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].outcome, 'retake');
  assert.equal(attempts[0].linked_event_id, attempts[1].event_id);
  assert.equal(attempts[1].parent_event_id, attempts[0].event_id);
  assert.equal(attempts[1].outcome, 'goal');

  const result = resolveMatch({ provisional_event_stream: events, expected: { home: {}, away: {} } });
  assert.deepEqual(result.score, { home: 1, away: 0 });
  assert.equal(result.statistics.home.penalty_attempt_events, 2);
  assert.equal(result.statistics.home.penalty_retakes, 1);
  assert.equal(result.statistics.home.penalties_taken, 1);
  assert.equal(result.statistics.home.shots, 1);
  assert.equal(result.statistics.home.expected_goals, 0.76);
});

test('Module E rejects an awarded penalty without a linked attempt', () => {
  assert.throws(() => resolveMatch({
    provisional_event_stream: [
      { event_id: 'foul', minute: 20, side: 'away', against_side: 'home', type: 'foul', subtype: 'penalty_foul', linked_event_id: 'award' },
      { event_id: 'award', minute: 20, side: 'home', type: 'penalty', subtype: 'penalty_awarded', source_event_id: 'foul', linked_event_id: 'missing' }
    ]
  }), /missing its attempt/);
});

test('Module E rejects an orphan penalty attempt', () => {
  assert.throws(() => resolveMatch({
    provisional_event_stream: [
      { event_id: 'attempt', minute: 21, side: 'home', type: 'penalty', subtype: 'penalty_attempt', parent_event_id: 'missing', source_event_id: 'missing-foul', outcome: 'goal', linked_event_id: 'goal', xg: 0.76, on_target: true },
      { event_id: 'goal', minute: 21, side: 'home', type: 'goal', subtype: 'penalty_goal', parent_event_id: 'attempt', source_event_id: 'attempt', outcome: 'goal', on_target: true }
    ]
  }), /orphaned/);
});

test('Module E rejects a scored attempt without its goal event', () => {
  const penalty = buildPenaltyIncident({
    attackingSide: 'home', defendingSide: 'away', minute: 37, index: 1,
    taker: { player_id: 'home-9' }, offender: { player_id: 'away-4' }, random: sequence([0.2])
  }).filter((event) => event.type !== 'goal');
  assert.throws(() => resolveMatch({ provisional_event_stream: penalty }), /missing its goal event/);
});

test('Module E rejects an orphan penalty goal', () => {
  assert.throws(() => resolveMatch({
    provisional_event_stream: [
      { event_id: 'goal', minute: 21, side: 'home', type: 'goal', subtype: 'penalty_goal', parent_event_id: 'missing-attempt', source_event_id: 'missing-attempt', outcome: 'goal', on_target: true }
    ]
  }), /orphaned/);
});

test('linked public IDs share the fixture namespace', () => {
  const contract = { run_key: 'world-1:fixture-9', fixture: { fixture_id: 'fixture-9' } };
  assert.equal(publicEventId(contract, 'home-penalty-1-foul'), 'world-1:fixture-9:home-penalty-1-foul');
  assert.equal(publicEventId(contract, 'home-penalty-1-attempt-1'), 'world-1:fixture-9:home-penalty-1-attempt-1');
  assert.equal(publicEventId(contract, 'home-penalty-1-goal'), 'world-1:fixture-9:home-penalty-1-goal');
});
