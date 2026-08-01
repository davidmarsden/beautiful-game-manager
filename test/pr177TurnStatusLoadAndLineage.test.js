import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('turn status only considers runs belonging to the current canonical checkpoint', async () => {
  const status = await read('netlify/functions/world-turn-status.mjs');
  assert.match(status, /or=\(previous_checksum\.eq\.\$\{checksum\},next_checksum\.eq\.\$\{checksum\}\)/);
  assert.match(status, /run\.status === 'processing' && run\.previous_checksum === world\.save_checksum/);
  assert.match(status, /run\.status === 'complete' && run\.next_checksum === world\.save_checksum/);
  assert.match(status, /run\.status === 'failed' && run\.previous_checksum === world\.save_checksum/);
  assert.doesNotMatch(status, /runs\.find\(\(run\) => run\.status === 'processing'\) \|\| null/);
});

test('background recovery polls conservatively while the database is processing a turn', async () => {
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(client, /await sleep\(10000\)/);
  assert.doesNotMatch(client, /await sleep\(3000\)/);
  assert.match(client, /every ten seconds/);
});
