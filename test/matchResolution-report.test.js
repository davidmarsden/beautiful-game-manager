import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMatch, MATCH_RESOLUTION_VERSION } from '../src/matchEngine/modules/MatchResolution.js';
import { resolveCommentaryReport, COMMENTARY_REPORT_VERSION } from '../src/matchEngine/modules/CommentaryReport.js';

const eventGeneration = {
  seed_commitment: 'abc12345',
  expected: {
    home: { expected_goals: 1.6 },
    away: { expected_goals: 0.9 }
  },
  provisional_event_stream: [
    { event_id: 'away-card-1', minute: 70, side: 'away', type: 'yellow_card', player_id: 'a2', provisional: true },
    { event_id: 'home-goal-1', minute: 12, side: 'home', type: 'goal', player_id: 'h9', xg: 0.31, on_target: true, outcome: 'goal', provisional: true },
    { event_id: 'away-shot-1', minute: 31, side: 'away', type: 'shot', player_id: 'a9', xg: 0.11, on_target: true, outcome: 'saved', provisional: true },
    { event_id: 'home-goal-2', minute: 82, side: 'home', type: 'goal', player_id: 'h10', xg: 0.18, on_target: true, outcome: 'goal', provisional: true },
    { event_id: 'home-corner-1', minute: 45, side: 'home', type: 'set_piece', subtype: 'corner', provisional: true }
  ]
};

const fatigue = {
  home: { players: [{ player_id: 'h9', fitness: 92, projected_post_match_fitness_90: 58 }] },
  away: { players: [{ player_id: 'a9', fitness: 88, projected_post_match_fitness_90: 51 }] }
};

test('Module E validates, orders and makes the event stream official', () => {
  const resolved = resolveMatch(eventGeneration, fatigue);
  assert.equal(resolved.version, MATCH_RESOLUTION_VERSION);
  assert.deepEqual(resolved.score, { home: 2, away: 0 });
  assert.equal(resolved.result, 'home_win');
  assert.deepEqual(resolved.official_event_stream.map((event) => event.minute), [12, 31, 45, 70, 82]);
  assert.ok(resolved.official_event_stream.every((event) => event.official && !event.provisional));
  assert.equal(resolved.statistics.home.goals, 2);
  assert.equal(resolved.statistics.home.shots, 2);
  assert.equal(resolved.statistics.home.corners, 1);
  assert.equal(resolved.statistics.away.shots_on_target, 1);
  assert.equal(resolved.statistics.away.yellow_cards, 1);
  assert.equal(resolved.consistency.score_matches_goals, true);
  assert.equal(resolved.state_changes.persistence_pending, true);
  assert.ok(Object.isFrozen(resolved));
});

test('Module E rejects duplicate IDs and impossible goal records', () => {
  const duplicate = {
    ...eventGeneration,
    provisional_event_stream: [eventGeneration.provisional_event_stream[0], eventGeneration.provisional_event_stream[0]]
  };
  assert.throws(() => resolveMatch(duplicate), /duplicate event_id/);

  const impossibleGoal = {
    ...eventGeneration,
    provisional_event_stream: [{ event_id: 'bad-goal', minute: 2, side: 'home', type: 'goal', on_target: false }]
  };
  assert.throws(() => resolveMatch(impossibleGoal), /cannot be off target/);
});

test('Module F creates a factual report from official resolution state', () => {
  const resolution = resolveMatch(eventGeneration, fatigue);
  const contract = {
    fixture: { fixture_id: 'fixture-38' },
    teams: {
      home: { club_id: 'home', club_name: 'Southall Athletic' },
      away: { club_id: 'away', club_name: 'Northside City' }
    }
  };
  const quality = {
    home: { team_strength: 91, starters: [{ player_id: 'h9', display_name: 'Home Striker' }, { player_id: 'h10', display_name: 'Home Winger' }] },
    away: { team_strength: 88, starters: [{ player_id: 'a9', display_name: 'Away Forward' }, { player_id: 'a2', display_name: 'Away Defender' }] }
  };
  const tactical = {
    home: { formation: '4-3-3-wide', style: 'high_press', route_to_goal: 'wide' },
    away: { formation: '4-2-3-1', style: 'low_block', route_to_goal: 'central' },
    matchup: { net: { home_advantage: 0.05, away_advantage: -0.05 } }
  };
  const report = resolveCommentaryReport(contract, resolution, tactical, quality, fatigue);

  assert.equal(report.version, COMMENTARY_REPORT_VERSION);
  assert.equal(report.headline, 'Southall Athletic beat Northside City 2-0');
  assert.match(report.summary, /Southall Athletic 2-0 Northside City/);
  assert.ok(report.commentary.some((row) => row.text === 'Home Striker scores for Southall Athletic.'));
  assert.ok(report.talking_points.some((point) => point.includes('tactical plan')));
  assert.equal(report.statistics.home.goals, 2);
  assert.equal(report.report_complete, true);
  assert.equal(report.public_contract_transition_pending, true);
  assert.ok(Object.isFrozen(report.commentary));
});

test('Module F refuses to report an unresolved match', () => {
  assert.throws(() => resolveCommentaryReport({ teams: {} }, {}), /requires completed Module E/);
});
