import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guard = read('public/match-centre-runtime-guard.js');
const links = read('public/match-centre-player-links.js');

test('Match Centre decorators load the replay runtime guard first', () => {
  assert.match(links, /^import '\.\/match-centre-runtime-guard\.js';/);
});

test('opening another match tears down the visible replay before the existing bubbling handler runs', () => {
  assert.match(guard, /document\.addEventListener\('click',[\s\S]*true\);/);
  assert.match(guard, /\[data-match-centre\]/);
  assert.match(guard, /close\.click\(\)/);
});

test('keyboard replay launches use the same synchronous teardown path', () => {
  assert.match(guard, /document\.addEventListener\('keydown'/);
  assert.match(guard, /\['Enter', ' '\]\.includes\(event\.key\)/);
});

test('page lifecycle hides cannot leave the replay interval alive', () => {
  assert.match(guard, /window\.addEventListener\('pagehide', teardownVisibleReplay\)/);
});

test('retained Match Centre result is compacted after projections are available', () => {
  assert.match(guard, /function compactMatchCentrePayload/);
  assert.match(guard, /statistics: result\.statistics/);
  assert.match(guard, /model: result\.model/);
  assert.doesNotMatch(guard, /compactResult[\s\S]*events: result\.events/);
});
