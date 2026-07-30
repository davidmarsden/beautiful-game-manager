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

test('canonical rehydration yields immediately to deliberate manager changes', async () => {
  const source = await read('public/canonical-submission-rehydration.js');
  assert.match(source, /if \(!event\.isTrusted\) return/);
  assert.match(source, /#interactiveFormationBoard/);
  assert.match(source, /#loadPreset/);
  assert.match(source, /#loadPreviousMatch/);
  assert.match(source, /managerOverride = true/);
  assert.match(source, /cancelRehydration\(\)/);
});
