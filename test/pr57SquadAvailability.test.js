import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAvailabilityChanges,
  availabilityForPlayer,
  availabilitySnapshot,
  createSquadAvailability,
  eligiblePlayerIds
} from '../src/matchEngine/squadAvailability.js';

test('injury absence persists for its declared match window and then clears', () => {
  const calendar = createSquadAvailability(['p1', 'p2']);
  const changes = applyAvailabilityChanges(calendar, {
    state_changes: { injuries: [{ player_id: 'p1', matches_out: 2, injury_type: 'hamstring' }] }
  }, { matchday: 3 });

  assert.deepEqual(changes, [{ player_id: 'p1', kind: 'injury', matches_out: 2, until_matchday: 5 }]);
  assert.equal(availabilityForPlayer(calendar, 'p1', 4).reason, 'injured');
  assert.equal(availabilityForPlayer(calendar, 'p1', 5).reason, 'injured');
  assert.equal(availabilityForPlayer(calendar, 'p1', 6).available, true);
});

test('red cards and explicit suspensions create deterministic unavailability', () => {
  const calendar = createSquadAvailability(['p1', 'p2', 'p3']);
  applyAvailabilityChanges(calendar, {
    state_changes: {
      discipline: [
        { player_id: 'p1', sent_off: true },
        { player_id: 'p2', suspension_matches: 3 }
      ]
    }
  }, { matchday: 7 });

  assert.equal(availabilityForPlayer(calendar, 'p1', 8).reason, 'suspended');
  assert.equal(availabilityForPlayer(calendar, 'p1', 9).available, true);
  assert.equal(availabilityForPlayer(calendar, 'p2', 10).reason, 'suspended');
  assert.equal(availabilityForPlayer(calendar, 'p2', 11).available, true);
  assert.deepEqual(eligiblePlayerIds(calendar, ['p1', 'p2', 'p3'], 8), ['p3']);
});

test('overlapping absences extend rather than shorten existing windows', () => {
  const calendar = createSquadAvailability(['p1']);
  applyAvailabilityChanges(calendar, { state_changes: { injuries: [{ player_id: 'p1', matches_out: 4 }] } }, { matchday: 2 });
  applyAvailabilityChanges(calendar, { state_changes: { injuries: [{ player_id: 'p1', matches_out: 1 }] } }, { matchday: 3 });
  assert.equal(availabilityForPlayer(calendar, 'p1', 6).reason, 'injured');
  assert.equal(availabilityForPlayer(calendar, 'p1', 7).available, true);
});

test('snapshot distinguishes all available and unavailable players', () => {
  const calendar = createSquadAvailability(['p1', 'p2']);
  applyAvailabilityChanges(calendar, { state_changes: { discipline: [{ player_id: 'p2', sent_off: true }] } }, { matchday: 1 });
  const snapshot = availabilitySnapshot(calendar, 2);
  assert.deepEqual(snapshot.available.map((row) => row.player_id), ['p1']);
  assert.deepEqual(snapshot.unavailable.map((row) => row.player_id), ['p2']);
});

test('calendar rejects duplicate player identities and unknown players stay ineligible', () => {
  assert.throws(() => createSquadAvailability(['p1', 'p1']), /unique/);
  const calendar = createSquadAvailability(['p1']);
  assert.deepEqual(availabilityForPlayer(calendar, 'missing', 1), { available: false, reason: 'unknown_player' });
});

test('prototype-like identities cannot bypass unknown-player guards or mutate calendar state', () => {
  const calendar = createSquadAvailability(['p1']);
  assert.equal(Object.getPrototypeOf(calendar.players), null);
  assert.deepEqual(availabilityForPlayer(calendar, 'toString', 1), { available: false, reason: 'unknown_player' });
  assert.deepEqual(availabilityForPlayer(calendar, '__proto__', 1), { available: false, reason: 'unknown_player' });
  assert.deepEqual(eligiblePlayerIds(calendar, ['p1', 'toString', '__proto__'], 1), ['p1']);

  const changes = applyAvailabilityChanges(calendar, {
    state_changes: {
      injuries: [{ player_id: '__proto__', matches_out: 9 }],
      discipline: [{ player_id: 'toString', sent_off: true }]
    }
  }, { matchday: 2 });

  assert.deepEqual(changes, []);
  assert.equal(Object.getPrototypeOf(calendar.players), null);
  assert.equal(availabilityForPlayer(calendar, 'p1', 3).available, true);
});
