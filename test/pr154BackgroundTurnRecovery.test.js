import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin turn recovery uses a Netlify background function instead of a long browser request', async () => {
  const background = await read('netlify/functions/run-due-turn-now-background.mjs');
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(background, /export \{ default \} from '\.\/run-due-turn-now\.mjs'/);
  assert.match(client, /\/api\/run-due-turn-now-background/);
  assert.match(client, /response\.status !== 202/);
  assert.match(client, /Production turn queued/);
  assert.doesNotMatch(client, /\/api\/run-due-turn-now['"]/);
});

test('background recovery polls a lightweight canonical run ledger', async () => {
  const status = await read('netlify/functions/world-turn-status.mjs');
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(status, /world_turn_runs/);
  assert.match(status, /status === 'processing'/);
  assert.match(status, /world\.turn_status === 'failed'/);
  assert.match(status, /latest\.next_checksum === world\.save_checksum/);
  assert.match(status, /diagnostics/);
  assert.match(client, /\/api\/world-turn-status/);
  assert.match(client, /failing stage/);
  assert.match(client, /12 \* 60 \* 1000/);
});

test('queued retry ignores the pre-existing failed run until a newer attempt appears', async () => {
  const status = await read('netlify/functions/world-turn-status.mjs');
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(status, /operation_created_at: operation\?\.created_at \|\| null/);
  assert.match(client, /const baseline = await statusRequest\(\)/);
  assert.match(client, /const queuedAt = Date\.now\(\)/);
  assert.match(client, /isNewerThanQueuedBaseline\(status, baseline, queuedAt\)/);
  assert.match(client, /status\.run\?\.id !== baseline\.run\?\.id/);
  assert.match(client, /status\.operation_id !== baseline\.operation_id/);
  assert.match(client, /status\.operation_created_at/);
  assert.match(client, /status\.state === 'failed' && belongsToQueuedAttempt/);
  assert.match(client, /Waiting for the background worker to claim the failed checkpoint/);
});

test('portal captures the bearer token before bootstrap and installs the background click interceptor', async () => {
  const html = await read('public/index.html');
  const bridge = await read('public/portal-auth-bridge.js');
  assert.ok(html.indexOf('portal-auth-bridge.js') < html.indexOf('type="module"'));
  assert.ok(html.indexOf('admin-turn-background-recovery.js') > html.indexOf('admin-turn-control.js'));
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(bridge, /authorization/);
});