import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 transfer deal cards stack summary and controls instead of squeezing them horizontally', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /\.incoming-transfer-offer\s*\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.transfer-negotiation-workspace \.world-control-status\s*\{[\s\S]*?white-space:normal/);
  assert.doesNotMatch(css, /\.transfer-negotiation-workspace \.world-control-status\s*\{[\s\S]*?white-space:nowrap/);
});

test('#272 transfer deal summaries and composer review have readable contained sections', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /\.transfer-exchange-summary-side\s*\{/);
  assert.match(css, /\.transfer-deal-review\s*\{/);
  assert.match(css, /@media\(max-width:1100px\)\s*\{[\s\S]*?\.transfer-negotiation-grid\s*\{\s*grid-template-columns:1fr\s*\}/);
});
