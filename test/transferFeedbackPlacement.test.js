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
  assert.match(source, /message\.setAttribute\('aria-live', 'polite'\)/);
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

test('mirrored transfer feedback is visual-only so screen readers hear one live region', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /local\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(source, /local\.setAttribute\('role', 'status'\)/);
  assert.doesNotMatch(source, /local\.setAttribute\('aria-live'/);
  assert.match(source, /single accessible live region/i);
});

test('listing feedback tracks the exact clicked player listing across refreshes', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /type: 'listing', playerId: control\.dataset\.playerId/);
  assert.match(source, /\[data-withdraw-listing\]\[data-player-id=/);
  assert.match(source, /findControlHost\('#activeTransferListings'/);
  assert.match(source, /directChildContaining\(container, control\)/);
});

test('concurrent listing withdrawals cannot steal the action-local feedback target', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /let listingActionInFlight = false/);
  assert.match(source, /if \(listingActionInFlight\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);/);
  assert.match(source, /setListingControlsDisabled\(true\)/);
  assert.match(source, /text === 'Transfer listing withdrawn immediately\.'/);
  assert.match(source, /listingAwaitingRefresh = true/);
  assert.match(source, /listingActionInFlight && listingAwaitingRefresh/);
  assert.match(source, /releaseListingActionLock\(\)/);
});

test('legacy incoming and outgoing feedback stays with the clicked offer card', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /type: 'legacy-incoming', proposalId: control\.dataset\.proposalId/);
  assert.match(source, /type: 'legacy-outgoing', proposalId: control\.dataset\.proposalId/);
  assert.match(source, /findControlHost\('#incomingTransferOffers', `\[data-legacy-transfer-response\]/);
  assert.match(source, /findControlHost\('#outgoingTransferOffers', `\[data-withdraw-legacy-offer\]/);
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
