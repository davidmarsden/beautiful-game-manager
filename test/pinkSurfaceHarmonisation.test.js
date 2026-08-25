import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Transfers uses the current TBG Brazil surface hierarchy instead of legacy pink stock', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /background:var\(--tbg-colour-workspace-raised,#eef6e8\)/);
  assert.match(css, /background:var\(--tbg-colour-cream,#f8f7e8\)/);
  assert.match(css, /background:var\(--tbg-brazil-yellow,#FFDC02\)!important/);
  assert.match(css, /border-top:3px solid var\(--tbg-brazil-blue,#193375\)/);
  assert.doesNotMatch(css, /#f5d7dd|#f6d4db|#fff0df/);
});

test('Player Updates inherits World-page Football Pink card surfaces', async () => {
  const css = await read('public/football-pink-stock.css');
  assert.match(css, /#updatesView \.player-updates-hero/);
  assert.match(css, /#updatesView \.player-updates-section/);
  assert.match(css, /background: var\(--tbg-surface-card\)/);
  assert.match(css, /#updatesView \.player-updates-pill[\s\S]*background: var\(--tbg-colour-workspace-raised\)/);
});
