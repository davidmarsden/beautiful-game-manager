import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduled = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn.mjs', import.meta.url), 'utf8');

test('scheduled dispatcher acknowledges background acceptance without running the turn inline', () => {
  assert.match(scheduled, /accepted: true, dispatched: true/);
  assert.match(scheduled, /202/);
});
