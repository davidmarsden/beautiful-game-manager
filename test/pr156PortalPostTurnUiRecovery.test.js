import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('boot recovery requires a rendered portal outcome rather than the empty shell', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /function portalOutcomeVisible\(\)/);
  assert.match(recovery, /document\.getElementById\('clubPortal'\)/);
  assert.match(recovery, /document\.getElementById\('unassignedState'\)/);
  assert.match(recovery, /document\.getElementById\('onboardingState'\)/);
  assert.match(recovery, /function usablePortalScreen\(\)[\s\S]*document\.getElementById\('authGate'\)[\s\S]*portalOutcomeVisible\(\)/);
  assert.doesNotMatch(recovery, /document\.getElementById\('portal'\),/);
});

test('slow boot remains informational while explicit bootstrap errors still escalate', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /const fatal = document\.querySelector\('#portal \.fatal-error'\)/);
  assert.match(recovery, /show\(fatal\.textContent\.trim\(\), 'bootstrap_error'\)/);
  assert.match(recovery, /if \(!recovery\) showLoading\(\)/);
  assert.match(recovery, /window\.setTimeout\(\(\) => \{[\s\S]*inspectPortal\(\);[\s\S]*refreshLoadingCopy\(\);[\s\S]*\}, 30000\)/);
  assert.doesNotMatch(recovery, /waitingOnly/);
  assert.doesNotMatch(recovery, /boot_watchdog/);
});

test('hiding the authenticated sign-in gate immediately exposes the loading state', async () => {
  const recovery = await read('public/portal-boot-recovery.js');
  assert.match(recovery, /new MutationObserver\(inspectPortal\)/);
  assert.match(recovery, /if \(usablePortalScreen\(\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(recovery, /if \(!recovery\) showLoading\(\)/);
  const inspectIndex = recovery.indexOf('function inspectPortal()');
  const showLoadingIndex = recovery.indexOf('if (!recovery) showLoading();', inspectIndex);
  const timeoutIndex = recovery.indexOf('window.setTimeout', inspectIndex);
  assert.ok(showLoadingIndex > inspectIndex && showLoadingIndex < timeoutIndex, 'mutation inspection must show loading before the passive 30-second check');
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
