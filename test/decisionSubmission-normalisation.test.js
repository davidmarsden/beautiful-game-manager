import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptManagerDecision } from '../src/decisionSubmission.js';

const playerIds = Array.from({ length: 11 }, (_, index) => `player-${index + 1}`);
const world = {
  clubs: [{ tbg_club_id: 'club-1', squad: { player_ids: playerIds } }]
};

test('accepted manager decisions strip unvalidated tactical extras', () => {
  const accepted = acceptManagerDecision({
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
    }
  }, world, '2026-07-18T18:00:00.000Z');

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
