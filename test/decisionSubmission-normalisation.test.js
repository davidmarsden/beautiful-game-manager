import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptManagerDecision, validateManagerDecision } from '../src/decisionSubmission.js';

const playerIds = Array.from({ length: 11 }, (_, index) => `player-${index + 1}`);
const world = {
  clubs: [{ tbg_club_id: 'club-1', squad: { player_ids: playerIds } }]
};

const decision = (overrides = {}) => ({
  manager_id: 'manager-1',
  club_id: 'club-1',
  fixture_id: 'fixture-1',
  formation: '4-3-3-wide',
  starting_xi: playerIds,
  bench: [],
  captain_id: playerIds[0],
  set_piece_takers: {},
  tactics: {
    mentality: 'balanced',
    pressing: 'mid',
    tempo: 'normal',
    width: 'balanced',
    defensive_line: 'standard',
    style: 'unsupported-client-value',
    route_to_goal: 'unsupported-client-value'
  },
  ...overrides
});

test('accepted manager decisions strip unvalidated tactical extras', () => {
  const accepted = acceptManagerDecision(decision(), world, '2026-07-18T18:00:00.000Z');

  assert.deepEqual(accepted.tactics, {
    mentality: 'balanced',
    pressing: 'mid',
    tempo: 'normal',
    width: 'balanced',
    defensive_line: 'standard'
  });
  assert.equal('style' in accepted.tactics, false);
  assert.equal('route_to_goal' in accepted.tactics, false);
});

test('rejects a loan player selected against his parent club when the competition enables the rule', () => {
  const restrictedWorld = {
    clubs: [
      { tbg_club_id: 'club-1', squad: { player_ids: playerIds } },
      { tbg_club_id: 'parent', squad: { player_ids: [] } }
    ],
    players: playerIds.map((id) => ({ tbg_player_id: id })),
    player_ownership: [{
      tbg_player_id: playerIds[0],
      club_id: 'parent',
      loan: { status: 'loaned_out', club_id: 'club-1' }
    }],
    fixtures: [{
      id: 'fixture-1',
      home_club_id: 'club-1',
      away_club_id: 'parent',
      competition_rules: { parent_club_restriction: true }
    }]
  };

  const result = validateManagerDecision(decision(), restrictedWorld);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('loan players cannot face their parent club')));
});

test('allows the same loan player when the rule is disabled', () => {
  const openWorld = {
    clubs: [{ tbg_club_id: 'club-1', squad: { player_ids: playerIds } }],
    players: playerIds.map((id) => ({ tbg_player_id: id })),
    player_ownership: [{ tbg_player_id: playerIds[0], club_id: 'parent', loan: { club_id: 'club-1' } }],
    fixtures: [{ id: 'fixture-1', home_club_id: 'club-1', away_club_id: 'parent' }]
  };
  assert.equal(validateManagerDecision(decision(), openWorld).valid, true);
});
