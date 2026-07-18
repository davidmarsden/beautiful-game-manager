import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPenaltyIncident } from '../src/matchEngine/modules/EventGeneration.js';
import { resolveMatch } from '../src/matchEngine/modules/MatchResolution.js';
import { publicEventId } from '../src/matchEngine/constitutionalPublicResult.js';

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1];
}

test('penalty incident is deterministic and fully linked', () => {
  const events = buildPenaltyIncident({
    attackingSide: 'home',
    defendingSide: 'away',
    minute: 37,
    index: 1,
    taker: { player_id: 'home-9' },
    offender: { player_id: 'away-4' },
    random: sequence([0.2])
  });
  assert.equal(events.length, 3);
  const [foul, award, attempt] = events;
  assert.equal(foul.type, 'foul');
  assert.equal(foul.subtype, 'penalty_foul');
  assert.equal(foul.linked_event_id, award.event_id);
  assert.equal(award.source_event_id, foul.event_id);
  assert.equal(award.linked_event_id, attempt.event_id);
  assert.equal(attempt.parent_event_id, award.event_id);
  assert.equal(attempt.source_event_id, foul.event_id);
  assert.equal(attempt.outcome, 'goal');
});

test('Module E reconciles penalty score, xG and foul statistics', () => {
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
  assert.equal(result.statistics.home.penalties_awarded, 1);
  assert.equal(result.statistics.home.penalties_taken, 1);
  assert.equal(result.statistics.home.penalties_scored, 1);
  assert.equal(result.statistics.home.expected_goals, 0.76);
  assert.equal(result.statistics.home.fouls_committed, 1);
  assert.equal(result.statistics.away.fouls_committed, 1);
  assert.equal(result.statistics.home.fouls_won, 1);
  assert.equal(result.consistency.linked_penalties_reconciled, true);
});

test('Module E rejects an awarded penalty without a linked attempt', () => {
  assert.throws(() => resolveMatch({
    provisional_event_stream: [
      { event_id: 'foul', minute: 20, side: 'away', against_side: 'home', type: 'foul', subtype: 'penalty_foul', linked_event_id: 'award' },
      { event_id: 'award', minute: 20, side: 'home', type: 'penalty', subtype: 'penalty_awarded', source_event_id: 'foul', linked_event_id: 'missing' }
    ]
  }), /missing its attempt/);
});

test('linked public IDs share the fixture namespace', () => {
  const contract = { run_key: 'world-1:fixture-9', fixture: { fixture_id: 'fixture-9' } };
  assert.equal(publicEventId(contract, 'home-penalty-1-foul'), 'world-1:fixture-9:home-penalty-1-foul');
  assert.equal(publicEventId(contract, 'home-penalty-1-attempt'), 'world-1:fixture-9:home-penalty-1-attempt');
});
