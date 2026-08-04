import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const statusFunction = fs.readFileSync(new URL('../netlify/functions/world-turn-status.mjs', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../public/admin-turn-background-recovery.js', import.meta.url), 'utf8');

test('status endpoint prioritizes reconciliation-required over locking', () => {
  assert.match(statusFunction, /if \(reconciliationRequired\) state = 'reconciliation_required'/);
  assert.match(statusFunction, /run\.status === 'reconciliation_required'/);
});

test('admin UI stops polling and requests recovery review', () => {
  assert.match(adminUi, /status\.state === 'reconciliation_required'/);
  assert.match(adminUi, /Recovery review required/);
  assert.match(adminUi, /canonical lock and manager submissions have been preserved/);
});
