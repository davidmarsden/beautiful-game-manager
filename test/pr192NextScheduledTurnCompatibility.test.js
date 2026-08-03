import test from 'node:test';
import assert from 'node:assert/strict';

import { nextScheduledTurn } from '../netlify/functions/scheduled-world-turn.mjs';

test('scheduled-world-turn retains the nextScheduledTurn named export for initializer compatibility', () => {
  const next = nextScheduledTurn(new Date('2026-08-03T12:00:00.000Z'));
  assert.equal(typeof next, 'string');
  assert.ok(new Date(next) > new Date('2026-08-03T12:00:00.000Z'));
});
