import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Transfers uses shared Football Pink surfaces instead of white overlays', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /background:var\(--tbg-surface-card,#f5d7dd\)/);
  assert.match(css, /background:var\(--tbg-colour-workspace-raised,#f6d4db\)/);
  assert.match(css, /background:var\(--tbg-colour-cream,#fff0df\)/);
  assert.doesNotMatch(css, /background:rgba\(255,255,255,/);
});

test('Player Updates inherits World-page Football Pink card surfaces', async () => {
  const css = await read('public/football-pink-stock.css');
  assert.match(css, /#updatesView \.player-updates-hero/);
  assert.match(css, /#updatesView \.player-updates-section/);
  assert.match(css, /background: var\(--tbg-surface-card\)/);
  assert.match(css, /#updatesView \.player-updates-pill[\s\S]*background: var\(--tbg-colour-workspace-raised\)/);
});
