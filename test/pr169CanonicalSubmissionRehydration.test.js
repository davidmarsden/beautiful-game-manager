import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('latest canonical submission remains authoritative after later portal renders', async () => {
  const [html, source] = await Promise.all([
    read('public/index.html'),
    read('public/canonical-submission-rehydration.js')
  ]);

  const boardIndex = html.indexOf('formation-board.js');
  const canonicalIndex = html.indexOf('canonical-submission-rehydration.js');
  assert.ok(boardIndex >= 0 && canonicalIndex > boardIndex, 'canonical rehydration must load after the formation board');
  assert.match(source, /state\?\.current_submission/);
  assert.match(source, /startingXi\.length !== 11/);
  assert.match(source, /bench\.length !== 7/);
  assert.match(source, /reorderSelector\('startingXi', 'xi', submission\.starting_xi\)/);
  assert.match(source, /reorderSelector\('bench', 'bench', submission\.bench\)/);
  assert.match(source, /dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(source, /window\.addEventListener\('tbg:portal-rendered'/);
  assert.match(source, /window\.addEventListener\('tbg:formation-board-ready'/);
  assert.match(source, /window\.addEventListener\('tbg:team-submission-saved'/);
});

test('canonical rehydration yields immediately and permanently to deliberate manager changes', async () => {
  const source = await read('public/canonical-submission-rehydration.js');
  assert.match(source, /if \(!event\.isTrusted\) return/);
  assert.match(source, /#interactiveFormationBoard/);
  assert.match(source, /#loadPreset/);
  assert.match(source, /#loadPreviousMatch/);
  assert.match(source, /managerOverride = true/);
  assert.match(source, /if \(managerOverride\) return false/);
  assert.doesNotMatch(source, /function scheduleCanonicalRehydration\(state\) \{[\s\S]*managerOverride = false/);
  assert.match(source, /cancelRehydration\(\)/);
});

test('drag and pointer edits cancel delayed canonical restoration', async () => {
  const source = await read('public/canonical-submission-rehydration.js');
  assert.match(source, /\['click', 'change', 'pointerdown', 'dragstart', 'drop'\]/);
  assert.match(source, /document\.addEventListener\(eventName, markManagerOverride, true\)/);
});

test('save events rehydrate only from refreshed state or the accepted saved payload', async () => {
  const source = await read('public/canonical-submission-rehydration.js');
  assert.match(source, /function stateFromSavedEvent\(detail\)/);
  assert.match(source, /if \(detail\?\.state\?\.current_submission\) return detail\.state/);
  assert.match(source, /if \(!result\?\.saved\) return null/);
  assert.match(source, /const savedState = stateFromSavedEvent\(event\.detail\)/);
  assert.match(source, /if \(savedState\) scheduleCanonicalRehydration\(savedState, \{ resetOverride: true \}\)/);
  assert.doesNotMatch(source, /scheduleCanonicalRehydration\(event\.detail\?\.state \|\| window\.tbgPortalState\)/);
});