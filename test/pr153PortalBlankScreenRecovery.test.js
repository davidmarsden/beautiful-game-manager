import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('portal boot guard loads before module scripts and exposes recovery actions', async () => {
  const html = await read('public/index.html');
  const guardIndex = html.indexOf('portal-boot-recovery.js');
  const moduleIndex = html.indexOf('type="module"');
  assert.ok(guardIndex >= 0, 'boot recovery script must be present');
  assert.ok(moduleIndex >= 0, 'portal module scripts must be present');
  assert.ok(guardIndex < moduleIndex, 'boot recovery must execute before portal modules');
});

test('portal boot guard catches runtime, rejection, bootstrap and empty-screen failures', async () => {
  const guard = await read('public/portal-boot-recovery.js');
  assert.match(guard, /window\.addEventListener\('error'/);
  assert.match(guard, /window\.addEventListener\('unhandledrejection'/);
  assert.match(guard, /#portal \.fatal-error/);
  assert.match(guard, /new MutationObserver\(inspectPortal\)/);
  assert.match(guard, /boot_watchdog/);
  assert.match(guard, /Retry portal/);
  assert.match(guard, /Open World/);
  assert.match(guard, /Clear session and sign out/);
  assert.match(guard, /Your canonical world has not been changed by this screen/);
});
