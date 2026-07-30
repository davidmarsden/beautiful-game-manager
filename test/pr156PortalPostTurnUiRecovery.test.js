import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('boot watchdog requires a rendered portal state rather than the empty shell', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /function usablePortalScreen\(\)/);
  assert.match(recovery, /document\.getElementById\('authGate'\)/);
  assert.match(recovery, /document\.getElementById\('clubPortal'\)/);
  assert.match(recovery, /document\.getElementById\('unassignedState'\)/);
  assert.match(recovery, /document\.getElementById\('onboardingState'\)/);
  assert.doesNotMatch(recovery, /document\.getElementById\('portal'\),/);
  assert.match(recovery, /if \(!usablePortalScreen\(\) && !recovery && !fatal\?\.textContent\?\.trim\(\)\)/);
});

test('boot watchdog preserves an explicit bootstrap or runtime recovery message', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /inspectPortal\(\);[\s\S]*const recovery = document\.getElementById\('portalBootRecovery'\)/);
  assert.match(recovery, /const fatal = document\.querySelector\('#portal \.fatal-error'\)/);
  assert.match(recovery, /!recovery/);
  assert.match(recovery, /!fatal\?\.textContent\?\.trim\(\)/);
  assert.match(recovery, /show\(fatal\.textContent\.trim\(\), 'bootstrap_error'\)/);
});

test('shared-world requests reuse and prime the portal authorization bridge', async () => {
  const html = await read('public/index.html');
  const bridge = await read('public/shared-world-auth-bridge.js');
  assert.ok(html.indexOf('shared-world-auth-bridge.js') < html.indexOf('type="module"'));
  assert.match(bridge, /\/api\/shared-world/);
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(bridge, /headers\.set\('authorization'/);
  assert.match(bridge, /AUTH_PRIME_URL/);
  assert.match(bridge, /window\.addEventListener\('tbg:portal-rendered'/);
  assert.match(bridge, /window\.fetch\(AUTH_PRIME_URL, \{ headers: \{ authorization \} \}\)/);
  assert.match(bridge, /return new Response\(null, \{ status: 204 \}\)/);
});
