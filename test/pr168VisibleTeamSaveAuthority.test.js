import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('visible pitch and bench are synchronized before the reliable submit controller runs', async () => {
  const [html, cache] = await Promise.all([
    read('public/index.html'),
    read('public/portal-state-cache.js')
  ]);
  const cacheIndex = html.indexOf('portal-state-cache.js');
  const controllerIndex = html.indexOf('team-selection-submission-reliability.js');
  assert.ok(cacheIndex >= 0 && controllerIndex > cacheIndex, 'pre-submit synchronization must register before the save controller');
  assert.match(cache, /document\.addEventListener\('submit', synchronizeLegacySelectorsFromVisibleBoard, true\)/);
  assert.match(cache, /orderedVisiblePlayerIds\('#formationPitch \.formation-slot'\)/);
  assert.match(cache, /orderedVisiblePlayerIds\('#formationBench \.bench-slot'\)/);
  assert.match(cache, /startingXi\.length !== 11 \|\| bench\.length !== 7/);
  assert.match(cache, /reorderCheckedLabels\('startingXi', startingXi\)/);
  assert.match(cache, /reorderCheckedLabels\('bench', bench\)/);
});

test('ambiguous decision writes receive one idempotent retry before failure is surfaced', async () => {
  const cache = await read('public/portal-state-cache.js');
  assert.match(cache, /const isDecisionWrite/);
  assert.match(cache, /status === 408 \|\| status === 429 \|\| status >= 500/);
  assert.match(cache, /async function fetchDecisionWithRetry/);
  assert.match(cache, /catch \{\s*return networkFetch\(input, init\);\s*\}/s);
  assert.match(cache, /if \(!retryableDecisionStatus\(firstResponse\.status\)\) return firstResponse/);
  assert.match(cache, /return networkFetch\(input, init\)/);
  assert.match(cache, /if \(isDecisionWrite\(input, init\)\) return fetchDecisionWithRetry\(input, init\)/);
});
