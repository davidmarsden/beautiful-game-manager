import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatSquadFitness } from '../public/squad-fitness-display.js';

test('squad fitness display rounds canonical values without changing stored data', () => {
  assert.equal(formatSquadFitness(78.3), '78%');
  assert.equal(formatSquadFitness(98.889), '99%');
  assert.equal(formatSquadFitness('62.9%'), '63%');
});

test('manager portal loads squad fitness display polish', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /squad-fitness-display\.js/);
});
