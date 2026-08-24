import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer action feedback is loaded and moved above the tall transfer grid', async () => {
  const [loader, source] = await Promise.all([
    read('public/internal-profile-links.js'),
    read('public/transfer-feedback-placement.js')
  ]);

  assert.match(loader, /import '\.\/transfer-feedback-placement\.js';/);
  assert.match(source, /transferNegotiationMessage/);
  assert.match(source, /world-control-heading/);
  assert.match(source, /transfer-negotiation-grid/);
  assert.match(source, /heading\.after\(message\)/);
  assert.match(source, /transfer-feedback-banner/);
  assert.match(source, /aria-live/);
  assert.match(source, /MutationObserver/);
});
