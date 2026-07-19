import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';
import { resolveMatch } from '../src/matchEngine/modules/MatchResolution.js';

const starters = (side) => Array.from({ length: 11 }, (_, index) => ({
  player_id: `${side}-${index + 1}`,
  required_role: index === 0 ? 'gk' : index < 5 ? 'cb' : index < 9 ? 'cm' : 'st',
  effective_quality: 90 - index
}));
const bench = (side) => Array.from({ length: 5 }, (_, index) => ({ player_id: `${side}-bench-${index + 1}`, effective_quality: 82 - index }));
const quality = {
  home: { starters: starters('home'), bench: { players: bench('home') } },
  away: { starters: starters('away'), bench: { players: bench('away') } }
};
const contract = {
  teams: {
    home: { starting_xi: starters('home').map((player) => player.player_id), bench: bench('home').map((player) => player.player_id) },
    away: { starting_xi: starters('away').map((player) => player.player_id), bench: bench('away').map((player) => player.player_id) }
  },
  match_state: { players: {} }
};

function eventGeneration(events) {
  return { provisional_event_stream: events, expected: { home: { expected_goals: 1 }, away: { expected_goals: 1 } }, seed_commitment: 'abc123' };
}

test('an injury triggers a linked replacement when a bench player is available', () => {
  const result = resolveLineupEvents(eventGeneration([
    { event_id: 'home-injury-1', minute: 24, side: 'home', type: 'injury', player_id: 'home-6' }
  ]), contract, quality);
  const injurySub = result.events.find((event) => event.type === 'substitution' && event.reason === 'injury');
  assert.ok(injurySub);
  assert.equal(injurySub.minute, 25);
  assert.equal(injurySub.player_out_id, 'home-6');
  assert.equal(injurySub.player_in_id, 'home-bench-1');
  assert.equal(injurySub.source_event_id, 'home-injury-1');
  assert.equal(result.lineups.home.final_on_pitch.includes('home-6'), false);
  assert.equal(result.lineups.home.final_on_pitch.includes('home-bench-1'), true);
});

test('substituted players cannot remain active or receive later events', () => {
  const result = resolveLineupEvents(eventGeneration([
    { event_id: 'home-injury-1', minute: 24, side: 'home', type: 'injury', player_id: 'home-6' },
    { event_id: 'home-shot-late', minute: 40, side: 'home', type: 'shot', player_id: 'home-6', on_target: false, outcome: 'missed' }
  ]), contract, quality);
  const lateShot = result.events.find((event) => event.event_id === 'home-shot-late');
  assert.notEqual(lateShot.player_id, 'home-6');
  assert.equal(lateShot.reassigned_from_player_id, 'home-6');
});

test('second yellow dismissal removes the player without introducing a replacement', () => {
  const result = resolveLineupEvents(eventGeneration([
    { event_id: 'home-yellow-1', minute: 20, side: 'home', type: 'yellow_card', player_id: 'home-4' },
    { event_id: 'home-yellow-2', minute: 55, side: 'home', type: 'yellow_card', player_id: 'home-4' }
  ]), contract, quality);
  assert.equal(result.lineups.home.final_on_pitch.includes('home-4'), false);
  assert.equal(result.lineups.home.final_on_pitch.length, 10);
});

test('Module E reconciles substitutions, lineup state and minutes-based fitness', () => {
  const fatiguePlayers = starters('home').map((player) => ({ player_id: player.player_id, fitness: 100, projected_post_match_fitness_90: 70 }));
  const awayFatigue = starters('away').map((player) => ({ player_id: player.player_id, fitness: 100, projected_post_match_fitness_90: 70 }));
  const result = resolveMatch(eventGeneration([
    { event_id: 'home-injury-1', minute: 24, side: 'home', type: 'injury', player_id: 'home-6' }
  ]), { home: { players: fatiguePlayers }, away: { players: awayFatigue } }, { contract, quality });
  assert.ok(result.statistics.home.substitutions >= 1);
  assert.equal(result.statistics.home.injury_substitutions, 1);
  assert.equal(result.consistency.substitutions_reconciled, true);
  assert.equal(result.lineup_state.home.final_on_pitch.includes('home-6'), false);
  const injuredFitness = result.state_changes.fitness.find((row) => row.player_id === 'home-6');
  const replacementFitness = result.state_changes.fitness.find((row) => row.player_id === 'home-bench-1');
  assert.equal(injuredFitness.minutes_played, 25);
  assert.ok(injuredFitness.projected_post_match_fitness > 70);
  assert.equal(replacementFitness.minutes_played, 65);
});

test('a bench player cannot be introduced twice', () => {
  const malformed = eventGeneration([
    { event_id: 'sub-1', minute: 60, side: 'home', type: 'substitution', player_out_id: 'home-2', player_in_id: 'home-bench-1' },
    { event_id: 'sub-2', minute: 70, side: 'home', type: 'substitution', player_out_id: 'home-3', player_in_id: 'home-bench-1' }
  ]);
  assert.throws(() => resolveMatch(malformed, {}, { contract, quality }), /introduces unavailable player/);
});
