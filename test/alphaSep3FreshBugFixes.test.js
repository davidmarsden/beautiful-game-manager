import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('external rated players never acquire for a zero or sub-threshold fee', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /const MIN_EXTERNAL_ACQUISITION_FEE_EUR = 100_000/);
  assert.match(endpoint, /function governedExternalAcquisitionFee\(value\)/);
  assert.match(endpoint, /Math\.max\(MIN_EXTERNAL_ACQUISITION_FEE_EUR, marketValue\)/);
  assert.match(endpoint, /external_acquisition_fee_eur: acquisitionFee/);
  assert.match(endpoint, /Number\(player\.external_acquisition_fee_eur\) < MIN_EXTERNAL_ACQUISITION_FEE_EUR/);
  assert.match(endpoint, /invalid_external_acquisition_fee/);
});

test('internal notification actions stay in the signed-in portal instead of reloading it', async () => {
  const notifications = await read('public/manager-notifications.js');
  assert.match(notifications, /function followInternalAction\(actionUrl\)/);
  assert.match(notifications, /url\.origin !== window\.location\.origin/);
  assert.match(notifications, /url\.pathname === '\/alpha-updates\.html'/);
  assert.match(notifications, /document\.getElementById\('alphaUpdatesButton'\)\?\.click\(\)/);
  assert.match(notifications, /url\.pathname === '\/'/);
  assert.match(notifications, /document\.querySelectorAll\('\[data-view\]'\)/);
  assert.match(notifications, /history\.pushState/);
  assert.match(notifications, /if \(internalHandled\) event\.preventDefault\(\)/);
});

test('stale access-denied callback fragments cannot poison an existing portal session', async () => {
  const authEntry = await read('public/auth-entry.js');
  assert.match(authEntry, /if \(!code && !accessToken && !authError\) return false/);
  assert.match(authEntry, /if \(authError\) \{[\s\S]*client\.auth\.getSession\(\)/);
  assert.match(authEntry, /if \(data\.session\?\.access_token\) \{[\s\S]*history\.replaceState\(\{\}, document\.title, restoredPath\(\)\)/);
  const catchBlock = authEntry.slice(authEntry.indexOf('try {\n  await completeAuthCallback();'));
  assert.match(catchBlock, /sessionStorage\.setItem\("tbg_auth_callback_error", message\)/);
  assert.match(catchBlock, /history\.replaceState\(\{\}, document\.title, restoredPath\(\)\)/);
});
