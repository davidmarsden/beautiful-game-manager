import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('failed checkpoint repair records the superseded failed turn and reopens atomically', async () => {
  const endpoint = await source('netlify/functions/repair-canonical-registrations.mjs');
  assert.match(endpoint, /failedTurnLineage\(worldId, before\.save_checksum\)/);
  assert.match(endpoint, /world_turn_runs\?world_id=eq\./);
  assert.match(endpoint, /previous_checksum=eq\./);
  assert.match(endpoint, /superseded_failed_run_id/);
  assert.match(endpoint, /failed_checksum/);
  assert.match(endpoint, /replacementTurnStatus = recoveryLineage \? 'open' : before\.turn_status/);
  assert.match(endpoint, /recovery_lineage: recoveryLineage/);
  assert.match(endpoint, /p_expected_turn_status: before\.turn_status/);
  assert.match(endpoint, /apply_canonical_registration_repair/);
});

test('production retry validates explicit repaired-checkpoint lineage', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  assert.match(endpoint, /repairedFailureLineage\(worldId, before\.save_checksum\)/);
  assert.match(endpoint, /replacement_checksum=eq\./);
  assert.match(endpoint, /operation_type=eq\.registration_repair/);
  assert.match(endpoint, /superseded_failed_run_id/);
  assert.match(endpoint, /world_turn_runs\?id=eq\./);
  assert.match(endpoint, /failedRun\.previous_checksum !== explicit\.failed_checksum/);
  assert.match(endpoint, /retry_repaired_failed_turn/);
  assert.match(endpoint, /scheduled-turn-recovery:/);
  assert.match(endpoint, /repair_operation_id/);
});

test('current legacy repaired failed checkpoint can recover through immutable audit inference', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  assert.match(endpoint, /repair\.details\?\.before\?\.turn_status === 'failed'/);
  assert.match(endpoint, /legacyFailedChecksum/);
  assert.match(endpoint, /previous_checksum=eq\.\$\{encodeURIComponent\(legacyFailedChecksum\)\}/);
  assert.match(endpoint, /legacy_inferred: true/);
  assert.match(endpoint, /recovery_lineage_inferred/);
  assert.match(endpoint, /Failed world has no matching failed turn or repaired-checkpoint lineage/);
});

test('failed status is reopened only after a verified recovery source is selected', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  const recoveryIndex = endpoint.indexOf("recovery = { mode: 'retry_repaired_failed_turn'");
  const reopenIndex = endpoint.indexOf("turn_status=eq.failed");
  assert.ok(recoveryIndex >= 0);
  assert.ok(reopenIndex > recoveryIndex);
  assert.match(endpoint, /save_checksum=eq\.\$\{encodeURIComponent\(before\.save_checksum\)\}/);
  assert.match(endpoint, /Failed world changed before retry; replay rejected/);
});
