import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';

const starters = (side) => Array.from({ length: 11 }, (_, index) => ({
  player_id: `${side}-${index + 1}`,
  required_role: index === 0 ? 'gk' : index < 5 ? 'cb' : index < 9 ? 'cm' : 'st',
  actual_role: index === 0 ? 'gk' : index < 5 ? 'cb' : index < 9 ? 'cm' : 'st',
  effective_quality: 90 - index
}));

const bench = (side) => Array.from({ length: 7 }, (_, index) => ({
  player_id: `${side}-bench-${index + 1}`,
  actual_role: index === 6 ? 'gk' : index < 2 ? 'cb' : index < 5 ? 'cm' : 'st',
  effective_quality: 82 - index
}));

const quality = {
  home: { starters: starters('home'), bench: { players: bench('home') } },
  away: { starters: starters('away'), bench: { players: bench('away') } }
};

const contract = {
  teams: {
    home: {
      starting_xi: starters('home').map((player) => player.player_id),
      bench: bench('home').map((player) => player.player_id)
    },
    away: {
      starting_xi: starters('away').map((player) => player.player_id),
      bench: bench('away').map((player) => player.player_id)
    }
  }
};

const generation = (events) => ({
  provisional_event_stream: events,
  expected: { home: { expected_goals: 1 }, away: { expected_goals: 1 } },
  seed_commitment: 'reconciliation-test'
});

test('superseded provisional substitutions are discarded before lineup application', () => {
  const result = resolveLineupEvents(generation([
    {
      event_id: 'away-preplanned-substitution-1',
      minute: 50,
      side: 'away',
      type: 'substitution',
      player_out_id: 'away-11',
      player_in_id: 'away-bench-6',
      provisional: true
    },
    {
      event_id: 'away-preplanned-substitution-2',
      minute: 55,
      side: 'away',
      type: 'substitution',
      player_out_id: 'away-11',
      player_in_id: 'away-bench-5',
      provisional: true
    }
  ]), contract, quality);

  const conflicts = result.events.filter((event) => event.type === 'substitution' && event.player_out_id === 'away-11');
  assert.equal(conflicts.length, 1);
  assert.equal(result.lineups.away.substitutions.filter((event) => event.player_out_id === 'away-11').length, 1);
});

test('post-reassignment reconciliation drops a generated substitution invalidated by a reassigned second yellow', () => {
  const result = resolveLineupEvents(generation([
    { event_id: 'away-yellow-1', minute: 20, side: 'away', type: 'yellow_card', player_id: 'away-10' },
    { event_id: 'away-yellow-inactive', minute: 65, side: 'away', type: 'yellow_card', player_id: 'away-11' }
  ]), contract, quality);

  const reassignedCard = result.events.find((event) => event.event_id === 'away-yellow-inactive');
  assert.equal(reassignedCard?.reassigned_from_player_id, 'away-11');
  assert.equal(reassignedCard?.player_id, 'away-10');
  assert.equal(result.lineups.away.final_on_pitch.includes('away-10'), false);
  assert.equal(result.events.some((event) => event.type === 'substitution' && event.player_out_id === 'away-10'), false);
});

test('malformed non-provisional substitutions still fail loudly', () => {
  assert.throws(() => resolveLineupEvents(generation([
    {
      event_id: 'away-invalid-substitution-1',
      minute: 50,
      side: 'away',
      type: 'substitution',
      player_out_id: 'away-11',
      player_in_id: 'away-bench-6'
    },
    {
      event_id: 'away-invalid-substitution-2',
      minute: 55,
      side: 'away',
      type: 'substitution',
      player_out_id: 'away-11',
      player_in_id: 'away-bench-5'
    }
  ]), contract, quality), /substitution removes inactive player/);
});
