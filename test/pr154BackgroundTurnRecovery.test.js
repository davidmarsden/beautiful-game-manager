import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin turn recovery uses a Netlify background function instead of a long browser request', async () => {
  const background = await read('netlify/functions/run-due-turn-now-background.mjs');
  const client = await read('public/admin-turn-background-recovery.js');
  assert.match(background, /import runDueTurnNow from '\.\/run-due-turn-now\.mjs'/);
  assert.match(background, /return runDueTurnNow\(request\)/);
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
  assert.match(client, /baseline = \{ \.\.\.\(await statusRequest\(\)\), unavailable: false \}/);
  assert.match(client, /const queuedAt = Date\.now\(\)/);
  assert.match(client, /isNewerThanQueuedBaseline\(status, baseline, queuedAt\)/);
  assert.match(client, /!baseline\.unavailable && status\.run\?\.id/);
  assert.match(client, /!baseline\.unavailable && status\.operation_id/);
  assert.match(client, /status\.operation_created_at/);
  assert.match(client, /status\.state === 'failed' && belongsToQueuedAttempt/);
  assert.match(client, /Waiting for the background worker to claim the failed checkpoint/);
});

test('a temporary status preflight failure cannot block the replay-safe queue request', async () => {
  const client = await read('public/admin-turn-background-recovery.js');
  const preflight = client.indexOf('baseline = { ...(await statusRequest()), unavailable: false }');
  const queue = client.indexOf("fetch('/api/run-due-turn-now-background'");
  assert.ok(preflight >= 0 && queue > preflight, 'status preflight must remain before queueing for baseline correlation');
  assert.match(client, /try \{\s*baseline = \{ \.\.\.\(await statusRequest\(\)\), unavailable: false \};\s*\} catch \(error\) \{/s);
  assert.match(client, /server-side replay protection will remain authoritative/);
  assert.doesNotMatch(client, /const baseline = await statusRequest\(\)/);
});

test('portal captures the bearer token before bootstrap and installs the background click interceptor', async () => {
  const html = await read('public/index.html');
  const bridge = await read('public/portal-auth-bridge.js');
  assert.ok(html.indexOf('portal-auth-bridge.js') < html.indexOf('type="module"'));
  assert.ok(html.indexOf('admin-turn-background-recovery.js') > html.indexOf('admin-turn-control.js'));
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(bridge, /authorization/);
});
