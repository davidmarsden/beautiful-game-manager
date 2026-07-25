import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FITNESS_DIALS,
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

test('recovery projection uses the canonical nine points per rest day', () => {
  assert.equal(FITNESS_DIALS.recovery_per_rest_day, 9);
  assert.equal(recoveryDays('2026-07-24T20:00:00.000Z', '2026-07-28T20:00:00.000Z'), 4);
  assert.equal(projectedKickoffFitness(61, 4), 97);
  assert.equal(projectedKickoffFitness(90, 4), 100);
});

test('post-match projection follows canonical workload dials', () => {
  assert.equal(FITNESS_DIALS.match_cost_per_90, 35);
  const normalCentreForward = projectedPostMatchFitness({ currentFitness: 100, role: 'CF', pressing: 'mid', tempo: 'normal', workRate: 50 });
  const highPressWingBack = projectedPostMatchFitness({ currentFitness: 100, role: 'LWB', pressing: 'high', tempo: 'fast', workRate: 80 });
  const goalkeeper = projectedPostMatchFitness({ currentFitness: 100, role: 'GK', pressing: 'mid', tempo: 'normal', workRate: 50 });
  assert.equal(normalCentreForward, 65);
  assert.ok(highPressWingBack < normalCentreForward);
  assert.ok(goalkeeper > normalCentreForward);
});

test('team selection loads fitness UI for pitch, bench, warnings and sorting', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../public/team-selection-fitness.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/team-selection-fitness.css', import.meta.url), 'utf8');
  assert.match(html, /team-selection-fitness\.css/);
  assert.match(html, /team-selection-fitness\.js/);
  assert.match(script, /#formationPitch \.formation-slot, #formationBench \.bench-slot/);
  assert.match(script, /Kick-off .*After 90m/s);
  assert.match(script, /fitnessSort/);
  assert.match(script, /Fitness warning:/);
  assert.match(script, /recovery days/);
  assert.match(css, /fitness-fresh/);
  assert.match(css, /fitness-fatigued/);
  assert.match(css, /low-fitness-selection/);
});
