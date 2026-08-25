import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer section cards use blue structure and yellow selected state', async () => {
  const css = await read('public/transfer-negotiations.css');

  assert.match(css, /\.transfer-section-card\{/);
  assert.match(css, /border:1px solid rgba\(25,51,117,\.34\)!important/);
  assert.match(css, /\.transfer-section-card\[aria-pressed="true"\]\{/);
  assert.match(css, /background:var\(--tbg-brazil-yellow,#FFDC02\)!important/);
  assert.match(css, /box-shadow:inset 0 -4px var\(--tbg-brazil-blue,#193375\)!important/);
});

test('transfer packages use neutral cards with blue player and yellow cash hierarchy', async () => {
  const css = await read('public/transfer-negotiations.css');

  assert.match(css, /\.transfer-history-row\.transfer-history-package\{/);
  assert.match(css, /border-left:4px solid var\(--tbg-brazil-blue,#193375\)/);
  assert.match(css, /\.transfer-history-package>div:first-child>strong\{/);
  assert.match(css, /color:var\(--tbg-brazil-blue,#193375\)/);
  assert.match(css, /\.transfer-history-leg\{/);
  assert.match(css, /background:rgba\(12,135,209,\.07\)/);
  assert.match(css, /\.transfer-history-cash\{/);
  assert.match(css, /background:rgba\(255,220,2,\.18\)/);
});

test('transfer workspaces no longer use green card fill for every content layer', async () => {
  const css = await read('public/transfer-negotiations.css');

  assert.match(css, /\.transfer-negotiation-grid>article\{[\s\S]*background:var\(--tbg-colour-cream,#f8f7e8\)/);
  assert.match(css, /\.transfer-exchange-summary-side\{[\s\S]*background:#fff/);
  assert.match(css, /\.transfer-deal-review\{[\s\S]*background:#fff/);
  assert.match(css, /\.transfer-legacy-note\{[\s\S]*background:var\(--tbg-colour-cream,#f8f7e8\)/);
});
