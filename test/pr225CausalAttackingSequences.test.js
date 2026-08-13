import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPenaltyIncident } from '../src/matchEngine/modules/EventGeneration.js';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';
import {
  realiseCausalEventGeneration,
  reconcileCausalResolution
} from '../src/matchEngine/CausalEventRealisation.js';
import { reconcileOwnGoalRatings } from '../src/matchEngine/OwnGoalRatings.js';

const quality = {
  home: { starters: [{ player_id: 'h1', display_name: 'Home Forward', required_role: 'st' }] },
  away: { starters: [
    { player_id: 'a1', display_name: 'Away Centre Back', required_role: 'cb' },
    { player_id: 'a2', display_name: 'Away Keeper', required_role: 'gk' }
  ] }
};

function generated(events) {
  return {
    version: 'raw',
    provisional_event_stream: events,
    provisional_score: { home: 0, away: 0 },
    event_counts: {},
    commentary_hooks: []
  };
}

test('every open-play goal is preceded by a linked attempt without changing the score', () => {
  const result = realiseCausalEventGeneration(generated([
    { event_id: 'home-chance-1', minute: 44, side: 'home', type: 'goal', player_id: 'h1', xg: 0.18, on_target: true, outcome: 'goal', provisional: true }
  ]), quality);

  const attempt = result.provisional_event_stream.find((event) => ['shot', 'big_chance'].includes(event.type));
  const goal = result.provisional_event_stream.find((event) => event.type === 'goal');
  assert.ok(attempt);
  assert.ok(goal);
  assert.equal(attempt.minute, goal.minute);
  assert.equal(attempt.outcome, 'goal');
  assert.equal(attempt.linked_event_id, goal.event_id);
  assert.equal(goal.source_event_id, attempt.event_id);
  assert.equal(goal.parent_event_id, attempt.event_id);
  assert.deepEqual(result.provisional_score, { home: 1, away: 0 });

  const moduleESort = [...result.provisional_event_stream].sort((a, b) => a.minute - b.minute || a.event_id.localeCompare(b.event_id));
  assert.ok(moduleESort.indexOf(attempt) < moduleESort.indexOf(goal), 'Module E lexical ordering must preserve attempt before goal');
});

test('non-goal attempts expose football outcomes rather than standalone goal events', () => {
  const result = realiseCausalEventGeneration(generated([
    { event_id: 'home-chance-saved', minute: 15, side: 'home', type: 'shot', player_id: 'h1', xg: 0.12, on_target: true, outcome: 'saved', provisional: true },
    { event_id: 'home-chance-missed', minute: 18, side: 'home', type: 'shot', player_id: 'h1', xg: 0.08, on_target: false, outcome: 'missed', provisional: true }
  ]), quality);
  const attempts = result.provisional_event_stream.filter((event) => ['shot', 'big_chance'].includes(event.type));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].outcome, 'saved');
  assert.ok(['missed', 'offside', 'woodwork'].includes(attempts[1].outcome));
  assert.equal(result.provisional_event_stream.filter((event) => event.type === 'goal').length, 0);
});

test('corners and free kicks feed only same-side existing attempts without inflating shot volume', () => {
  const homeChances = Array.from({ length: 20 }, (_, index) => ({
    event_id: `home-chance-${index + 1}`, minute: 10 + index, side: 'home', type: 'shot', player_id: 'h1', xg: 0.1, on_target: false, outcome: 'missed', provisional: true
  }));
  const awayChances = Array.from({ length: 20 }, (_, index) => ({
    event_id: `away-chance-${index + 1}`, minute: 10 + index, side: 'away', type: 'shot', player_id: 'a1', xg: 0.1, on_target: false, outcome: 'missed', provisional: true
  }));
  const setPieces = Array.from({ length: 20 }, (_, index) => ({
    event_id: `${index % 2 ? 'away' : 'home'}-set-piece-${index + 1}`,
    minute: 40 + index,
    side: index % 2 ? 'away' : 'home',
    type: 'set_piece', subtype: index % 3 ? 'free_kick' : 'corner', provisional: true
  }));
  const result = realiseCausalEventGeneration(generated([...homeChances, ...awayChances, ...setPieces]), quality);
  const attempts = result.provisional_event_stream.filter((event) => ['shot', 'big_chance'].includes(event.type));
  const linkedSetPieces = result.provisional_event_stream.filter((event) => event.type === 'set_piece' && event.linked_event_id);
  assert.equal(attempts.length, homeChances.length + awayChances.length, 'set pieces must reuse the existing chance budget rather than create extra shots');
  assert.ok(linkedSetPieces.length > 0);
  for (const setPiece of linkedSetPieces) {
    const attempt = result.provisional_event_stream.find((event) => event.event_id === setPiece.linked_event_id);
    assert.ok(attempt);
    assert.equal(attempt.side, setPiece.side, 'a set piece must never parent the opponent attempt');
    assert.equal(attempt.parent_event_id, setPiece.event_id);
    assert.equal(attempt.minute, setPiece.minute);
  }
});

test('penalty incidents remain atomic and cannot admit an unrelated same-minute event', () => {
  const randomValues = [0.1];
  const random = () => randomValues.shift() ?? 0.1;
  const incident = buildPenaltyIncident({
    attackingSide: 'home', defendingSide: 'away', minute: 25, index: 1,
    taker: { player_id: 'h1' }, offender: { player_id: 'a1' }, random
  });
  const unrelated = { event_id: 'away-set-piece-99', minute: 25, side: 'away', type: 'set_piece', subtype: 'corner', provisional: true };
  const result = realiseCausalEventGeneration(generated([...incident, unrelated]), quality);
  const ordered = [...result.provisional_event_stream].sort((a, b) => a.minute - b.minute || a.event_id.localeCompare(b.event_id));
  const penaltyRows = ordered.filter((event) => event.sequence_id === 'sequence-home-penalty-1');
  assert.ok(penaltyRows.length >= 4);
  assert.ok(penaltyRows.every((event) => event.minute === 25), 'award and resolution must share one incident minute');
  const indexes = penaltyRows.map((event) => ordered.indexOf(event));
  assert.equal(Math.max(...indexes) - Math.min(...indexes) + 1, indexes.length, 'an unrelated event must not interleave inside the penalty sequence');
  assert.deepEqual(penaltyRows.map((event) => event.type), ['foul', 'penalty', 'penalty', 'goal']);
});

test('linked goal events do not double-count the attempt in shot totals', () => {
  const reconciled = reconcileCausalResolution({
    version: 'resolution',
    official_event_stream: [
      { event_id: 's-10-attempt', minute: 50, side: 'home', type: 'shot', outcome: 'goal', on_target: true },
      { event_id: 's-20-goal', minute: 50, side: 'home', type: 'goal', subtype: 'open_play_goal', source_event_id: 's-10-attempt', outcome: 'goal', on_target: true }
    ],
    statistics: {
      home: { shots: 2, shots_on_target: 2 },
      away: { shots: 0, shots_on_target: 0 }
    },
    consistency: {}
  });
  assert.equal(reconciled.statistics.home.shots, 1);
  assert.equal(reconciled.statistics.home.shots_on_target, 1);
});

test('own-goal defender identity survives lineup actor reconciliation', () => {
  let generatedOwnGoal = null;
  for (let index = 0; index < 1000 && !generatedOwnGoal; index += 1) {
    const result = realiseCausalEventGeneration(generated([
      { event_id: `own-goal-search-${index}`, minute: 60, side: 'home', type: 'goal', player_id: 'h1', xg: 0.2, on_target: true, outcome: 'goal', provisional: true }
    ]), quality);
    const goal = result.provisional_event_stream.find((event) => event.type === 'goal' && event.own_goal === true) || null;
    if (goal) generatedOwnGoal = { result, goal };
  }
  assert.ok(generatedOwnGoal, 'deterministic own-goal path should be reachable');
  assert.equal(generatedOwnGoal.goal.side, 'home');
  assert.equal(generatedOwnGoal.goal.player_id, 'h1', 'Module E actor remains on the scoring side');
  assert.equal(generatedOwnGoal.goal.own_goal_player_id, 'a1', 'defending scorer identity is stored separately');
  assert.equal(generatedOwnGoal.goal.subtype, 'own_goal');

  const contract = { teams: { home: { bench: [] }, away: { bench: [] } } };
  const resolved = resolveLineupEvents(generatedOwnGoal.result, contract, quality);
  const finalGoal = resolved.events.find((event) => event.own_goal === true);
  assert.equal(finalGoal.player_id, 'h1');
  assert.equal(finalGoal.own_goal_player_id, 'a1');
  assert.equal(finalGoal.reassigned_from_player_id, undefined, 'own goal must not trigger attacking-side reassignment of the defender');
});

test('own goal removes the false attacking reward and applies a real defender penalty', () => {
  const ratings = {
    deterministic: true,
    version: 'ratings',
    home: [{ player_id: 'h1', minutes_played: 90, rating: 7.4, components: { event_impact: 1.15, match_context: 0.2 }, highlights: ['1 goal'] }],
    away: [{ player_id: 'a1', minutes_played: 90, rating: 6.0, components: { event_impact: 0, match_context: 0 }, highlights: [] }],
    player_of_the_match: null
  };
  const resolution = {
    official_event_stream: [
      { event_id: 'og', type: 'goal', side: 'home', minute: 90, own_goal: true, player_id: 'h1', own_goal_player_id: 'a1' }
    ]
  };
  const reconciled = reconcileOwnGoalRatings(ratings, resolution);
  const attacker = reconciled.home.find((row) => row.player_id === 'h1');
  const defender = reconciled.away.find((row) => row.player_id === 'a1');
  assert.equal(attacker.rating, 6.1, 'the false 1.15 goal reward and 0.2 decisive context are removed');
  assert.equal(attacker.components.match_context, 0);
  assert.equal(defender.rating, 4.9, 'the defender receives a net own-goal penalty rather than merely losing a false reward');
  assert.ok(defender.highlights.includes('1 own goal'));
});
