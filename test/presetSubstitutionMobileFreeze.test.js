import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('preset substitution player selects are not rebuilt on unrelated formation-board mutations', async () => {
  const source = await read('public/preset-substitutions.js');
  assert.match(source, /function teamSheetSignature\(\)/);
  assert.match(source, /if \(!force && signature === lastTeamSheetSignature\) return/);
  assert.match(source, /function sameValues\(left, right\)/);
  assert.match(source, /if \(sameValues\(optionValues\(select\), expectedValues\)\) continue/);
  assert.match(source, /function mutationChangesTeamSheet\(mutations\)/);
  assert.match(source, /if \(mutationChangesTeamSheet\(mutations\)\) schedulePlayerOptionSync\(\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => \{/);
});

test('formation observer only reacts to lineup token changes rather than fitness decoration', async () => {
  const source = await read('public/preset-substitutions.js');
  assert.match(source, /attributeFilter: \['data-player-id'\]/);
  assert.match(source, /\.formation-slot,\.bench-slot,\.player-token/);
  assert.doesNotMatch(source, /new MutationObserver\(\(\) => syncPlayerOptions\(\)\)/);
});
