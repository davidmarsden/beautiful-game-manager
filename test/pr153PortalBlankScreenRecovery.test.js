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

test('portal boot guard shows loading immediately and only escalates after a delayed unhealthy boot', async () => {
  const guard = await read('public/portal-boot-recovery.js');
  assert.match(guard, /window\.addEventListener\('error'/);
  assert.match(guard, /window\.addEventListener\('unhandledrejection'/);
  assert.match(guard, /#portal \.fatal-error/);
  assert.match(guard, /new MutationObserver\(inspectPortal\)/);
  assert.match(guard, /attributes: true/);
  assert.match(guard, /attributeFilter: \['hidden', 'class', 'style'\]/);
  assert.match(guard, /function usablePortalScreen\(\)[\s\S]*document\.getElementById\('clubPortal'\)[\s\S]*document\.getElementById\('unassignedState'\)[\s\S]*\.some\(visible\)/);
  assert.doesNotMatch(guard, /function usablePortalScreen\(\)[\s\S]*document\.getElementById\('portal'\)/);
  assert.match(guard, /function showLoading\(\)/);
  assert.match(guard, /data-recovery-source="boot_loading"/);
  assert.match(guard, /Loading manager portal…/);
  assert.match(guard, /\['boot_loading', 'boot_watchdog'\]\.includes/);
  assert.match(guard, /waitingOnly = !recovery \|\| recovery\.dataset\.recoverySource === 'boot_loading'/);
  assert.match(guard, /within 30 seconds/);
  assert.match(guard, /\}, 30000\)/);
  assert.match(guard, /window\.tbgDismissPortalRecovery = clear/);
  assert.match(guard, /Retry portal/);
  assert.match(guard, /Open World/);
  assert.match(guard, /Clear session and sign out/);
  assert.match(guard, /Your canonical world has not been changed by this screen/);
});

test('Open World recovery route is honoured by portal navigation', async () => {
  const guard = await read('public/portal-boot-recovery.js');
  const navigation = await read('public/portal-navigation.js');
  assert.match(guard, /url\.searchParams\.set\('view', 'world'\)/);
  assert.match(navigation, /new URLSearchParams\(window\.location\.search\)\.get\('view'\)/);
  assert.match(navigation, /const requested = requestedInitialView\(\)/);
  assert.match(navigation, /if \(!showPortalView\(requested\)\) showPortalView\('dashboard'\)/);
  assert.doesNotMatch(
    navigation,
    /window\.addEventListener\('tbg:portal-rendered', \(\) => \{\s*installHistoryShell\(\);\s*showPortalView\('dashboard'\);/,
    'portal render must not unconditionally force Dashboard before considering the requested recovery view'
  );
});
