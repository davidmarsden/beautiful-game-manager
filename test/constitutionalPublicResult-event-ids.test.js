import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTITUTIONAL_PUBLIC_ADAPTER_VERSION,
  publicEventId,
  runConstitutionalPublicResult
} from '../src/matchEngine/constitutionalPublicResult.js';

function makeContext(runKey, fixtureId) {
  const state = {
    module_d_event_generation: {
      expected: {
        home: { control_share: 0.54 },
        away: { control_share: 0.46 }
      }
    },
    module_e_match_resolution: {
      resolution_complete: true,
      seed_commitment: 'seed-1',
      score: { home: 1, away: 0 },
      result: 'home_win',
      official_event_stream: [
        {
          event_id: 'home-chance-1',
          type: 'goal',
          side: 'home',
          minute: 17,
          player_id: 'home-9',
          xg: 0.28,
          on_target: true,
          outcome: 'goal'
        }
      ],
      statistics: {
        home: { shots: 1, shots_on_target: 1, expected_goals: 0.28, corners: 0, yellow_cards: 0, red_cards: 0 },
        away: { shots: 0, shots_on_target: 0, expected_goals: 0, corners: 0, yellow_cards: 0, red_cards: 0 }
      },
      state_changes: { persistence_pending: true }
    },
    module_f_commentary_report: {
      report_complete: true,
      headline: 'Home beat Away 1-0',
      summary: 'Home won 1-0.',
      talking_points: [],
      commentary: [
        { event_id: 'home-chance-1', text: 'Named Player scores for Home.' }
      ]
    }
  };

  return {
    contract: {
      run_key: runKey,
      fixture: { fixture_id: fixtureId },
      teams: {
        home: { club_id: 'home-club', club_name: 'Home' },
        away: { club_id: 'away-club', club_name: 'Away' }
      }
    },
    fixture: { fixture_id: fixtureId, kickoff_at: '2026-07-18T15:00:00.000Z' },
    get(key) { return state[key]; }
  };
}

test('public event IDs are namespaced by run key while internal IDs remain traceable', () => {
  const result = runConstitutionalPublicResult(makeContext('season-1:fixture-10', 'fixture-10'));
  assert.equal(result.events[0].event_id, 'season-1:fixture-10:home-chance-1');
  assert.equal(result.events[0].internal_event_id, 'home-chance-1');
  assert.equal(result.events[0].commentary, 'Named Player scores for Home.');
  assert.equal(result.model.adapter_version, CONSTITUTIONAL_PUBLIC_ADAPTER_VERSION);
});

test('identical internal event IDs cannot collide across fixtures', () => {
  const first = runConstitutionalPublicResult(makeContext('season-1:fixture-10', 'fixture-10'));
  const second = runConstitutionalPublicResult(makeContext('season-1:fixture-11', 'fixture-11'));
  assert.notEqual(first.events[0].event_id, second.events[0].event_id);
  assert.equal(first.events[0].internal_event_id, second.events[0].internal_event_id);
});

test('fixture ID is a deterministic fallback when run key is absent', () => {
  assert.equal(publicEventId({ fixture: { fixture_id: 'fixture-12' } }, 'away-card-1'), 'fixture-12:away-card-1');
});

test('adapter refuses to publish an event without a fixture namespace', () => {
  assert.throws(() => publicEventId({}, 'home-chance-1'), /requires run_key or fixture_id/);
  assert.throws(() => publicEventId({ run_key: 'run-1' }, ''), /missing event_id/);
});
