import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FITNESS_DIALS,
  canonicalSlotRole,
  fitnessBand,
  projectedKickoffFitness,
  projectedPostMatchFitness,
  recoveryDays
} from '../public/team-selection-fitness.js';

test('fitness bands communicate fresh, fit, tired and fatigued states', () => {
  assert.deepEqual(fitnessBand(95), { key: 'fresh', label: 'Fresh' });
  assert.deepEqual(fitnessBand(80), { key: 'fit', label: 'Fit' });
  assert.deepEqual(fitnessBand(65), { key: 'tired', label: 'Tired' });
  assert.deepEqual(fitnessBand(45), { key: 'fatigued', label: 'Fatigued' });
});

test('recovery projection uses the recalibrated five points per rest day', () => {
  assert.equal(FITNESS_DIALS.recovery_per_rest_day, 5);
  assert.equal(recoveryDays('2026-07-24T20:00:00.000Z', '2026-07-28T20:00:00.000Z'), 4);
  assert.equal(projectedKickoffFitness(61, 4), 81);
  assert.equal(projectedKickoffFitness(90, 4), 100);
});

test('post-match projection follows recalibrated workload dials', () => {
  assert.equal(FITNESS_DIALS.match_cost_per_90, 16);
  const normalCentreForward = projectedPostMatchFitness({ currentFitness: 100, role: 'st', pressing: 'mid', tempo: 'normal', workRate: 50 });
  const highPressWingBack = projectedPostMatchFitness({ currentFitness: 100, role: 'wing_back', pressing: 'high', tempo: 'fast', workRate: 80 });
  const goalkeeper = projectedPostMatchFitness({ currentFitness: 100, role: 'gk', pressing: 'mid', tempo: 'normal', workRate: 50 });
  assert.equal(normalCentreForward, 84);
  assert.ok(highPressWingBack < normalCentreForward);
  assert.ok(highPressWingBack >= 75 && highPressWingBack <= 76);
  assert.ok(goalkeeper > normalCentreForward);
});

test('formation slots match the engine canonical role mapping', () => {
  assert.equal(canonicalSlotRole('4-3-3-wide', 5), 'dm');
  assert.equal(canonicalSlotRole('4-3-3-wide', 8), 'wing');
  assert.equal(canonicalSlotRole('3-5-2', 5), 'cm');
  assert.equal(canonicalSlotRole('3-5-2', 6), 'dm');
  assert.equal(canonicalSlotRole('3-5-2', 8), 'wing_back');
});

test('team selection loads fitness UI for pitch, bench, warnings and sorting', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../public/team-selection-fitness.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/team-selection-fitness.css', import.meta.url), 'utf8');
  assert.match(html, /team-selection-fitness\.css/);
  assert.match(html, /team-selection-fitness\.js/);
  assert.match(script, /#formationPitch \.formation-slot, #formationBench \.bench-slot/);
  assert.match(script, /<small>Kick-off \$\{rounded\(projection\.kickoff\)\}% · \$\{postLabel\} \$\{rounded\(projection\.post\)\}%<\/small>/);
  assert.match(script, /canonicalSlotRole\(currentFormation\(\), slot\.dataset\.index\)/);
  assert.match(script, /fitnessSort/);
  assert.match(script, /Fitness warning:/);
  assert.match(script, /recovery days/);
  assert.match(css, /fitness-fresh/);
  assert.match(css, /fitness-fatigued/);
  assert.match(css, /low-fitness-selection/);
});
