import test from 'node:test';
import assert from 'node:assert/strict';
import { FITNESS_DIALS } from '../public/team-selection-fitness.js';
import {
  FATIGUE_CALIBRATION_BASELINE_DIALS,
  FATIGUE_DIALS,
  resolvePlayerContext
} from '../src/matchEngine/modules/FatigueContext.js';
import { DEFAULT_RECOVERY_PER_DAY, recoveredFitness } from '../src/matchEngine/MatchStatePersistence.js';

const player = (fitness = 100, workRate = 50) => ({
  tbg_player_id: 'p1',
  fitness,
  sharpness: 100,
  morale: 50,
  work_rate_rating: workRate
});

const context = (role, tactics = { pressing: 'mid', tempo: 'normal' }, fitness = 100, workRate = 50) =>
  resolvePlayerContext(player(fitness, workRate), { tactics }, role, {});

test('engine, persistence and manager UI expose the same recalibrated fatigue dials', () => {
  assert.deepEqual(
    { match_cost_per_90: FATIGUE_DIALS.match_cost_per_90, recovery_per_rest_day: FATIGUE_DIALS.recovery_per_rest_day },
    { match_cost_per_90: 16, recovery_per_rest_day: 5 }
  );
  assert.equal(DEFAULT_RECOVERY_PER_DAY, FATIGUE_DIALS.recovery_per_rest_day);
  assert.equal(FITNESS_DIALS.match_cost_per_90, FATIGUE_DIALS.match_cost_per_90);
  assert.equal(FITNESS_DIALS.recovery_per_rest_day, FATIGUE_DIALS.recovery_per_rest_day);
  assert.deepEqual(FATIGUE_CALIBRATION_BASELINE_DIALS, { match_cost_per_90: 35, recovery_per_rest_day: 9 });
});

test('ordinary 90-minute workloads land in the production target band', () => {
  const roles = ['fb', 'cb', 'dm', 'cm', 'wing', 'st'];
  const rows = roles.map((role) => context(role));
  const costs = rows.map((row) => row.projected_match_cost_90);
  const posts = rows.map((row) => row.projected_post_match_fitness_90);
  assert.ok(Math.min(...costs) >= 14);
  assert.ok(Math.max(...costs) <= 18);
  assert.ok(Math.min(...posts) >= 82);
  assert.ok(Math.max(...posts) <= 86);
});

test('starting fitness 90-100 usually finishes around the intended 72-88 band rather than collapsing', () => {
  const roles = ['fb', 'cb', 'dm', 'cm', 'wing', 'st'];
  const posts = [90, 95, 100].flatMap((fitness) => roles.map((role) => context(role, undefined, fitness).projected_post_match_fitness_90));
  assert.ok(Math.min(...posts) >= 72);
  assert.ok(posts.filter((value) => value < 70).length === 0);
  assert.ok(posts.filter((value) => value < 60).length === 0);
});

test('high press fast tempo and demanding roles still create exceptional fatigue', () => {
  const normal = context('cm');
  const extreme = context('wing_back', { pressing: 'high', tempo: 'fast' }, 100, 80);
  assert.ok(extreme.projected_match_cost_90 > 22);
  assert.ok(extreme.projected_match_cost_90 > normal.projected_match_cost_90);
  assert.ok(extreme.projected_post_match_fitness_90 >= 75 && extreme.projected_post_match_fitness_90 < 80);
});

test('two rest days restore ten points without erasing all congestion pressure', () => {
  assert.equal(recoveredFitness(
    { fitness: 78, season_id: 's1', last_played_at: '2026-08-10T20:00:00Z' },
    { season_id: 's1', kickoff_at: '2026-08-12T20:00:00Z' }
  ), 88);
  assert.equal(recoveredFitness(
    { fitness: 92, season_id: 's1', last_played_at: '2026-08-10T20:00:00Z' },
    { season_id: 's1', kickoff_at: '2026-08-12T20:00:00Z' }
  ), 100);
});
