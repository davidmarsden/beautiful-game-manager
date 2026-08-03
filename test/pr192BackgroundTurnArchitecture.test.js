import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduled = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn.mjs', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn-background.mjs', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn-worker.mjs', import.meta.url), 'utf8');
const status = fs.readFileSync(new URL('../netlify/functions/world-turn-status.mjs', import.meta.url), 'utf8');

test('scheduled function only dispatches the background worker', () => {
  assert.match(scheduled, /scheduled-world-turn-background/);
  assert.match(scheduled, /status = 200/);
  assert.match(scheduled, /dispatched: true/);
  assert.doesNotMatch(scheduled, /executeScheduledTurn/);
});

test('background worker wraps the preserved scheduler with checkpoint reconciliation', () => {
  assert.match(background, /createCheckpointReconciliationFetch/);
  assert.match(background, /scheduledWorldTurnWorker/);
  assert.match(background, /verifyInternalSchedulerRequest/);
  assert.match(worker, /replace_canonical_world_checkpoint/);
  assert.match(worker, /export default async/);
  assert.doesNotMatch(worker, /config = \{ schedule:/);
});

test('administrator status exposes reconciliation-required runs', () => {
  assert.match(status, /reconciliation_required/);
});
