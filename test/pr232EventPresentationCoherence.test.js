import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCausalResolution } from '../src/matchEngine/CausalEventRealisation.js';
import { runConstitutionalPublicResult } from '../src/matchEngine/constitutionalPublicResult.js';
import { decorateMatchCentrePayload, replayPresentationForEvent } from '../netlify/functions/match-centre-linked.mjs';

const stats = () => ({
  shots: 1, shots_on_target: 1, expected_goals: 0.1, corners: 1,
  fouls_committed: 0, fouls_won: 0, penalties_awarded: 0, penalties_taken: 0,
  penalties_scored: 0, penalties_saved: 0, penalties_missed: 0,
  substitutions: 0, injury_substitutions: 0, yellow_cards: 0, red_cards: 0
});

test('a second booking materialises an explicit second-yellow red event without changing the inferred match statistics', () => {
  const resolution = {
    version: 'test-resolution',
    official_event_stream: [
      { event_id: 'home-card-1', minute: 9, side: 'home', type: 'yellow_card', player_id: 'camavinga', official: true },
      { event_id: 'home-card-2', minute: 16, side: 'home', type: 'yellow_card', player_id: 'camavinga', official: true }
    ],
    statistics: {
      home: { ...stats(), yellow_cards: 2, red_cards: 1, straight_red_cards: 0, second_yellow_dismissals: 1 },
      away: stats()
    },
    consistency: {}
  };

  const reconciled = reconcileCausalResolution(resolution);
  const dismissal = reconciled.official_event_stream.find((event) => event.type === 'red_card');

  assert.ok(dismissal);
  assert.equal(dismissal.subtype, 'second_yellow');
  assert.equal(dismissal.player_id, 'camavinga');
  assert.equal(dismissal.minute, 16);
  assert.equal(dismissal.source_event_id, 'home-card-2');
  assert.equal(dismissal.official, true);
  assert.equal(reconciled.statistics.home.yellow_cards, 2);
  assert.equal(reconciled.statistics.home.red_cards, 1);
  assert.equal(reconciled.statistics.home.second_yellow_dismissals, 1);
  assert.equal(reconciled.consistency.second_yellow_dismissals_explicit, true);
});

test('public fallback commentary narrates a linked corner-shot-goal sequence and second-yellow dismissal coherently', () => {
  const resolution = {
    resolution_complete: true,
    seed_commitment: 'seed',
    score: { home: 1, away: 0 },
    result: 'home_win',
    official_event_stream: [
      { event_id: 'corner', sequence_id: 'seq-1', sequence_order: 0, minute: 6, side: 'home', type: 'set_piece', subtype: 'corner', linked_event_id: 'shot', official: true },
      { event_id: 'shot', sequence_id: 'seq-1', sequence_order: 10, minute: 6, side: 'home', type: 'shot', subtype: 'attempt', player_id: 'vini', outcome: 'goal', on_target: true, chance_origin: 'corner', linked_event_id: 'goal', official: true },
      { event_id: 'goal', sequence_id: 'seq-1', sequence_order: 20, minute: 6, side: 'home', against_side: 'away', type: 'goal', subtype: 'open_play_goal', player_id: 'vini', outcome: 'goal', on_target: true, chance_origin: 'corner', source_event_id: 'shot', parent_event_id: 'shot', official: true },
      { event_id: 'card-red', minute: 16, side: 'home', type: 'red_card', subtype: 'second_yellow', player_id: 'camavinga', source_event_id: 'card-2', official: true }
    ],
    statistics: { home: { ...stats(), goals: 1, yellow_cards: 2, red_cards: 1 }, away: stats() },
    lineup_state: {}, state_changes: {}
  };
  const report = { report_complete: true, commentary: [], headline: '', summary: '', talking_points: [] };
  const ratings = { deterministic: true, version: 'ratings', home: [], away: [], player_of_the_match: null };
  const eventGeneration = { expected: { home: { control_share: 0.5 }, away: { control_share: 0.5 } } };
  const values = new Map([
    ['module_e_match_resolution', resolution],
    ['module_f_commentary_report', report],
    ['module_g_performance_ratings', ratings],
    ['module_d_event_generation', eventGeneration]
  ]);
  const context = {
    contract: {
      run_key: 'run-1',
      fixture: { fixture_id: 'fixture-1' },
      teams: { home: { club_name: 'Real Madrid' }, away: { club_name: 'Borussia Dortmund' } }
    },
    fixture: { fixture_id: 'fixture-1', kickoff_at: '2026-08-16T20:00:00Z' },
    get: (key) => values.get(key)
  };

  const result = runConstitutionalPublicResult(context);
  assert.match(result.events[0].commentary, /corner.*immediate chance/i);
  assert.match(result.events[1].commentary, /decisive effort/i);
  assert.match(result.events[2].commentary, /GOAL!.*resulting corner/i);
  assert.match(result.events[3].commentary, /SECOND YELLOW.*sent off/i);
});

test('replay presentation promotes corners, contextual goals and explicit second-yellow reds', () => {
  const corner = replayPresentationForEvent({ event_type: 'set_piece', subtype: 'corner', sequence_id: 'seq-1', sequence_order: 0 });
  const goal = replayPresentationForEvent({ event_type: 'goal', chance_origin: 'corner', sequence_id: 'seq-1', sequence_order: 20 });
  const dismissal = replayPresentationForEvent({ event_type: 'red_card', subtype: 'second_yellow' });

  assert.equal(corner.label, 'CORNER');
  assert.equal(corner.importance, 'featured');
  assert.equal(corner.sequence_role, 'source');
  assert.equal(goal.label, 'GOAL · FROM CORNER');
  assert.equal(goal.sequence_role, 'climax');
  assert.equal(goal.major, true);
  assert.equal(dismissal.label, 'SECOND YELLOW · RED CARD');
  assert.equal(dismissal.kind, 'dismissal');
});

test('explicit second-yellow archive events prevent the legacy second booking from being promoted as a duplicate dismissal', () => {
  const payload = {
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [
      { minute: 9, side: 'home', event_type: 'yellow_card', player_id: 'p1', player_name: 'Booked' },
      { minute: 16, side: 'home', event_type: 'yellow_card', player_id: 'p1', player_name: 'Booked' },
      { minute: 16, side: 'home', event_type: 'red_card', subtype: 'second_yellow', player_id: 'p1', player_name: 'Booked' }
    ],
    submissions: [],
    summary: { scorers: { home: [], away: [] }, cards: { home: [], away: [] }, top_ratings: [] },
    player_performances: { home: [], away: [] }
  };

  const decorated = decorateMatchCentrePayload(payload, null);
  assert.equal(decorated.events[1].replay_presentation.label, 'YELLOW CARD');
  assert.equal(decorated.events[2].replay_presentation.label, 'SECOND YELLOW · RED CARD');
});
