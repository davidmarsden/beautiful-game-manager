import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn-worker.mjs', import.meta.url), 'utf8');

test('preserved worker retains the production scheduler version marker', () => {
  assert.match(worker, /tbg-scheduled-world-turn-v1\.8/);
});
