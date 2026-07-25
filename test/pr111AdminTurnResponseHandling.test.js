import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin turn control handles an HTML gateway response without reporting JSON syntax noise', async () => {
  const client = await source('public/admin-turn-control.js');
  assert.match(client, /async function responseJson\(response, fallbackMessage\)/);
  assert.match(client, /await response\.text\(\)/);
  assert.match(client, /content-type/);
  assert.match(client, /Production turn response was interrupted/);
  assert.match(client, /window\.location\.reload\(\)/);
  assert.doesNotMatch(client, /const result = await response\.json\(\);\n      if \(!response\.ok\)/);
});
