import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reconciliation = fs.readFileSync(new URL('../src/world/checkpointWriteFetchReconciliation.js', import.meta.url), 'utf8');

test('default reconciliation window extends beyond the database write timeout', () => {
  assert.match(reconciliation, /DEFAULT_SETTLEMENT_WINDOW_MS = 105000/);
});
