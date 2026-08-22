import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 deal summary always exposes both clubs, including an explicit Nothing side', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /ensureBothDealSides/);
  assert.match(source, /ownClubName/);
  assert.match(source, /counterpartName/);
  assert.match(source, />Nothing</);
  assert.match(source, /<strong>Deal<\/strong>/);
});

test('#272 counter interaction gives immediate loading feedback and a visible editor banner', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /Loading counter…/);
  assert.match(source, /Loading Revision \$\{revisionNo\} into the counter-offer editor/);
  assert.match(source, /Counter-offer to \$\{other\}/);
  assert.match(source, /Editing Revision \$\{revisionNo\}/);
  assert.match(source, /data-exchange-response="counter"/);
});
