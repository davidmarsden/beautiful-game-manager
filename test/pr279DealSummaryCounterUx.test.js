import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 deal summary always exposes both clubs without reintroducing HTML from club names', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /ensureBothDealSides/);
  assert.match(source, /appendEmptyDealSide/);
  assert.match(source, /heading\.textContent = `\$\{name\} gives`/);
  assert.match(source, /nothing\.textContent = 'Nothing'/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*`<strong>\$\{name\}/);
  assert.match(source, /<strong>Deal<\/strong>/);
});

test('#272 counter feedback is tied to actual click activation, including keyboard-generated clicks', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /document\.addEventListener\('click'/);
  assert.doesNotMatch(source, /addEventListener\('pointerdown'/);
  assert.match(source, /Loading counter…/);
  assert.match(source, /Loading Revision \$\{revisionNo\} into the counter-offer editor/);
});

test('#272 counter editor waits for the requested revision and counterpart before relabeling', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /message\.startsWith\(`Editing counter-offer to revision \$\{revisionNo\}\.\`\)/);
  assert.match(source, /selectedCounterpart === expectedCounterpart/);
  assert.match(source, /Counter-offer to \$\{other\}/);
  assert.match(source, /Editing Revision \$\{revisionNo\}/);
  assert.match(source, /activeCounterButton/);
});
