import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer action feedback keeps a page-level fallback above the tall transfer grid', async () => {
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

test('transfer feedback is mirrored beside the action that triggered it', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /LOCAL_FEEDBACK_ATTR/);
  assert.match(source, /#submitNegotiation/);
  assert.match(source, /\[data-deal-response\]/);
  assert.match(source, /\[data-agreed-change-action\]/);
  assert.match(source, /activeFeedbackTarget = \{ type: 'deal', dealId: card\.dataset\.firstClassDeal \}/);
  assert.match(source, /activeFeedbackTarget = \{ type: 'proposal' \}/);
  assert.match(source, /submit\.after\(local\)/);
  assert.match(source, /actions\.after\(local\)/);
  assert.match(source, /messageObserver\.observe\(message/);
  assert.match(source, /mirrorFeedbackLocally\(\)/);
});

test('offer-card refreshes can restore local feedback without observing unrelated app DOM', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /document\.getElementById\('transfersView'\)/);
  assert.match(source, /transferObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /if \(activeFeedbackTarget\) queueMicrotask\(\(\) => mirrorFeedbackLocally\(\)\)/);
  assert.doesNotMatch(source, /transferObserver\.observe\(document\.documentElement/);
});

test('initial placement observer remains temporary and scoped away from the whole document', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /document\.getElementById\('transfersView'\) \|\| document\.body/);
  assert.match(source, /placementObserver\.observe\(root/);
  assert.match(source, /placementObserver\?\.disconnect\(\)/);
  assert.match(source, /if \(placeTransferFeedback\(\)\) stopPlacementObserver\(\)/);
  assert.doesNotMatch(source, /observe\(document\.documentElement/);
});
