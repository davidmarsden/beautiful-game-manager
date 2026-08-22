import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 composer makes dropdown selection distinct from added deal players', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Choose a player to add…/);
  assert.match(source, /Choosing a player here does not add them to the deal\. Press Add player\./);
  assert.match(source, /ensurePickerPlaceholder/);
});

test('#272 composer shows a final You receive / You give review and explicit Nothing sides', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Review this deal before sending/);
  assert.match(source, /appendSide\(panel, 'You receive', receive\)/);
  assert.match(source, /appendSide\(panel, 'You give', offer\)/);
  assert.match(source, /entries\.length \? entries : \['Nothing'\]/);
});

test('#272 one-sided deal cannot be submitted without explicit acknowledgement', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Warning: you receive nothing in this deal\./);
  assert.match(source, /confirmOneSidedDeal/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /confirmedBefore/);
});

test('#272 hardening observer ignores review-panel mutations instead of self-looping', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /mutationComesFromReview/);
  assert.match(source, /!mutationComesFromReview\(mutation\)/);
});

test('#272 agreed multi-player deals do not expose legacy single-fee amendment UI', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /suppressLegacyComplexAmendments/);
  assert.match(source, /amendment\.hidden = true/);
  assert.match(source, /single-fee\/contract amendment form does not represent all deal legs/);
  assert.match(source, /mistake-grace cancellation or mutual cancellation/);
});

test('#272 exchange controls load composer hardening', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /import '\.\/transfer-deal-composer-hardening\.js';/);
});
