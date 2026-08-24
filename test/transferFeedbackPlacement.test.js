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
});

test('transfer feedback observer is temporary and scoped away from the whole document', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /new MutationObserver/);
  assert.match(source, /document\.getElementById\('transfersView'\) \|\| document\.body/);
  assert.match(source, /placementObserver\.observe\(root/);
  assert.match(source, /placementObserver\?\.disconnect\(\)/);
  assert.match(source, /if \(placeTransferFeedback\(\)\) stopPlacementObserver\(\)/);
  assert.doesNotMatch(source, /observe\(document\.documentElement/);
});
