import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('administrator operation invokes the production scheduled function rather than a parallel turn path', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  assert.match(endpoint, /import scheduledWorldTurn from '\.\/scheduled-world-turn\.mjs'/);
  assert.match(endpoint, /await scheduledWorldTurn\(\)/);
  assert.doesNotMatch(endpoint, /executeScheduledTurn|advanceIncrementalMatchday/);
});

test('administrator operation rejects early, claimed and replayed turns', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  assert.match(endpoint, /before\.turn_status !== 'open'/);
  assert.match(endpoint, /Canonical world is not due yet/);
  assert.match(endpoint, /operation_id=eq\./);
  assert.match(endpoint, /already been executed or recorded/);
});

test('administrator receives a compact observable pre and post checkpoint result', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  for (const field of ['matchday_advanced', 'next_matchday', 'previous_checksum', 'replacement_checksum', 'next_turn_at']) {
    assert.match(endpoint, new RegExp(field));
  }
  assert.match(endpoint, /world_operation_events/);
  assert.match(endpoint, /before:/);
  assert.match(endpoint, /after:/);
});

test('portal exposes administrator-only Run due turn now control and reloads canonical fixture state', async () => {
  const [control, index] = await Promise.all([
    source('public/admin-turn-control.js'),
    source('public/index.html')
  ]);
  assert.match(control, /bootstrap\?\.manager\?\.is_admin/);
  assert.match(control, /Run due turn now/);
  assert.match(control, /\/api\/run-due-turn-now/);
  assert.match(control, /window\.location\.reload\(\)/);
  assert.match(index, /admin-turn-control\.js/);
});
