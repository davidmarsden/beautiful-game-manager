import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const retryUrl = new URL('../netlify/functions/run-due-turn-now.mjs', import.meta.url);
const browserUrl = new URL('../public/admin-turn-background-recovery.js', import.meta.url);

test('failed-world retry survives transient Supabase reopen failures', async () => {
  const source = await readFile(retryUrl, 'utf8');

  assert.match(source, /error\.status = response\.status/);
  assert.match(source, /function isRetriableServiceError\(error\)/);
  assert.match(source, /error\.status >= 500/);
  assert.match(source, /async function reopenFailedWorldForRetry/);
  assert.match(source, /maxAttempts = 4/);
  assert.match(source, /current\?\.save_checksum === checksum && current\.turn_status === 'open'/);
  assert.match(source, /await reopenFailedWorldForRetry\(\{ worldId, checksum: before\.save_checksum, now \}\)/);
});

test('background UI distinguishes queued from genuinely processing', async () => {
  const source = await readFile(browserUrl, 'utf8');

  assert.match(source, /button\.textContent = 'Turn queued'/);
  assert.match(source, /status\.state === 'processing' && belongsToQueuedAttempt/);
  assert.match(source, /button\.textContent = 'Turn running in background'/);
});
