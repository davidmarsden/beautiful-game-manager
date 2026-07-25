import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('contract player dropdown is repopulated after bulk registration replaces the old card', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const fix = fs.readFileSync(new URL('../public/contract-player-options-fix.js', import.meta.url), 'utf8');

  assert.match(html, /contract-player-options-fix\.js/);
  assert.match(fix, /tbg:portal-rendered/);
  assert.match(fix, /document\.getElementById\('contractPlayer'\)/);
  assert.match(fix, /select\.innerHTML = contractOptions\(\)/);
  assert.match(fix, /MutationObserver/);
});
