import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 transfer deal cards stack summary and controls instead of squeezing them horizontally', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /\.incoming-transfer-offer\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.transfer-negotiation-workspace \.world-control-status\{white-space:normal/);
  assert.doesNotMatch(css, /\.transfer-negotiation-workspace \.world-control-status\{white-space:nowrap/);
});

test('#272 transfer deal summaries and composer review have readable contained sections', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /\.transfer-exchange-summary-side\{/);
  assert.match(css, /\.transfer-deal-review\{/);
  assert.match(css, /@media\(max-width:1100px\)\{\.transfer-negotiation-grid\{grid-template-columns:1fr\}\}/);
});
