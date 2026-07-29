import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('boot watchdog accepts the authenticated portal shell as a usable state', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /document\.getElementById\('portal'\)/);
  assert.match(recovery, /function usablePortalScreen\(\)/);
  assert.match(recovery, /if \(!usablePortalScreen\(\)\) show/);
});

test('shared-world requests reuse the portal authorization bridge', async () => {
  const html = await read('public/index.html');
  const bridge = await read('public/shared-world-auth-bridge.js');
  assert.ok(html.indexOf('shared-world-auth-bridge.js') < html.indexOf('type="module"'));
  assert.match(bridge, /\/api\/shared-world/);
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(bridge, /headers\.set\('authorization'/);
});
