import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reconciliation = fs.readFileSync(new URL('../src/world/checkpointWriteFetchReconciliation.js', import.meta.url), 'utf8');

test('checkpoint reconciliation reads only compact canonical metadata', () => {
  assert.match(reconciliation, /select=world_id,save_checksum,turn_status,updated_at/);
  assert.doesNotMatch(reconciliation, /select=\*/);
});
