import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 direct exchange controls expose actions from the displayed locked revision without bootstrap auth', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /response locked until atomic settlement is deployed/i);
  assert.match(source, /data-first-class-deal/);
  assert.match(source, /displayedRevision\(card\)/);
  assert.match(source, /data-exchange-response=\"accept\"/);
  assert.match(source, /data-exchange-response=\"counter\"/);
  assert.match(source, /data-exchange-response=\"decline\"/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /\/api\/transfer-exchange-response/);
});
