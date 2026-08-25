import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('action-local transfer feedback suppresses the duplicate global banner only for the current action', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /function syncGlobalFeedbackVisibility\(localShown\)/);
  assert.match(source, /message\.classList\.toggle\('transfer-feedback-suppressed', Boolean\(localShown\)\)/);
  assert.match(source, /#\$\{MESSAGE_ID\}\.transfer-feedback-suppressed/);
  assert.match(source, /function targetMatchesCurrentAction\(text\)/);
  assert.match(source, /baselineText/);
  assert.match(source, /capturedAt: Date\.now\(\)/);
  assert.match(source, /confirmed: false/);
  assert.match(source, /text === activeFeedbackTarget\.baselineText/);
  assert.match(source, /activeFeedbackTarget\.confirmed = true/);
  assert.match(source, /ACTION_FEEDBACK_WINDOW_MS/);
  assert.match(source, /syncGlobalFeedbackVisibility\(true\)/);
  assert.match(source, /syncGlobalFeedbackVisibility\(false\)/);
});

test('exchange response controls are captured as action-local deal targets', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /\[data-exchange-response\]/);
  assert.match(source, /control\.closest\('\[data-first-class-deal\]'\)/);
  assert.match(source, /type: 'deal', dealId: card\.dataset\.firstClassDeal/);
});

test('precise #329 listing and legacy targets retain current-action metadata', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /\{ \.\.\.common, type: 'listing', playerId: control\.dataset\.playerId/);
  assert.match(source, /\{ \.\.\.common, type: 'legacy-incoming', proposalId: control\.dataset\.proposalId/);
  assert.match(source, /\{ \.\.\.common, type: 'legacy-outgoing', proposalId: control\.dataset\.proposalId/);
});

test('unrecognized transfer clicks clear stale action targets and restore the global fallback', async () => {
  const source = await read('public/transfer-feedback-placement.js');

  assert.match(source, /if \(!control\) \{[\s\S]*activeFeedbackTarget = null;[\s\S]*syncGlobalFeedbackVisibility\(false\);[\s\S]*return;/);
});
