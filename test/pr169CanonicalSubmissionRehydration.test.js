import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical submission rehydration is quarantined from the production portal', async () => {
  const [html, source] = await Promise.all([
    read('public/index.html'),
    read('public/canonical-submission-rehydration.js')
  ]);

  assert.doesNotMatch(html, /canonical-submission-rehydration\.js/, 'the cross-page delayed DOM rehydrator must not run in production');
  assert.match(source, /function applyCanonicalSubmission\(\)/, 'the quarantined implementation remains available for redesign and diagnosis');
});

test('stable save and formation controllers remain loaded after quarantine', async () => {
  const html = await read('public/index.html');
  assert.match(html, /portal-state-cache\.js/);
  assert.match(html, /team-selection-submission-reliability\.js/);
  assert.match(html, /formation-board\.js/);
  assert.match(html, /bounded-submission-rehydration\.js/);
  assert.match(html, /world-controls\.js/);
});
