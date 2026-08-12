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

test('turn status exposes the run matching the canonical checkpoint state', async () => {
  const status = await read('netlify/functions/world-turn-status.mjs');
  assert.match(status, /const latest = state === 'processing'\s*\? processing\s*:\s*state === 'failed'\s*\? \(operationFailedRun \|\| failed\)\s*:\s*state === 'complete'\s*\? completed/s);
  assert.match(status, /else if \(operationFailedRun\) state = 'failed'/);
  assert.match(status, /operationFailureRun/);
  assert.doesNotMatch(status, /const latest = processing \|\| completed \|\| failed/);
});

test('retry attempts are ordered by actual attempt time with a deterministic tie-breaker', async () => {
  const status = await read('netlify/functions/world-turn-status.mjs');
  assert.match(status, /select=id,season_id,matchday,previous_checksum,next_checksum,status,scheduled_for,started_at,completed_at,error_message/);
  assert.match(status, /order=started_at\.desc\.nullslast,completed_at\.desc\.nullslast,id\.desc/);
  assert.doesNotMatch(status, /order=scheduled_for\.desc/);
});

test('background recovery polls conservatively while the database is processing a turn', async () => {
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(client, /await sleep\(10000\)/);
  assert.doesNotMatch(client, /await sleep\(3000\)/);
  assert.match(client, /every ten seconds/);
});
