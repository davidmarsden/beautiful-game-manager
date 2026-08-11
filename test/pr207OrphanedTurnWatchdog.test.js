import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled background sweeps stale canonical locks before normal processing', async () => {
  const source = await read('netlify/functions/scheduled-world-turn-background.mjs');
  assert.match(source, /recoverAbandonedScheduledTurns/);
  assert.match(source, /canonical_world_saves\?turn_status=eq\.locking&select=world_id,save_checksum,updated_at/);
  assert.match(source, /recover_stale_canonical_turn_lock/);
  assert.match(source, /p_expected_checksum: world\.save_checksum/);
  assert.match(source, /p_expected_updated_at: world\.updated_at/);
  assert.match(source, /p_lease: STALE_TURN_LEASE/);
  assert.match(source, /STALE_TURN_LEASE = '00:20:00'/);

  const watchdogIndex = source.indexOf('await recoverAbandonedScheduledTurns()');
  const schedulerIndex = source.indexOf('await executeScheduledWorldTurnWithReconciliation()');
  assert.ok(watchdogIndex >= 0 && schedulerIndex > watchdogIndex, 'stale-lock recovery must run before the scheduler worker');
});

test('watchdog leaves recovery authority in the existing atomic database RPC', async () => {
  const [source, migration] = await Promise.all([
    read('netlify/functions/scheduled-world-turn-background.mjs'),
    read('supabase/migrations/20260729_pr155_atomic_stale_turn_lock_recovery.sql')
  ]);

  assert.match(source, /p_requested_by: null/);
  assert.doesNotMatch(source, /PATCH[\s\S]*turn_status/);
  assert.match(migration, /v_world\.save_checksum <> p_expected_checksum or v_world\.updated_at <> p_expected_updated_at/);
  assert.match(migration, /if v_age < p_lease/);
  assert.match(migration, /set status = 'submitted', locked_at = null/);
  assert.match(migration, /set status = 'failed', error_message = v_reason, completed_at = p_now/);
  assert.match(migration, /set turn_status = 'failed', updated_at = p_now/);
});

test('watchdog failure cannot block unrelated open worlds', async () => {
  const source = await read('netlify/functions/scheduled-world-turn-background.mjs');
  assert.match(source, /try \{[\s\S]*recoverAbandonedScheduledTurns[\s\S]*\} catch \(error\) \{[\s\S]*console\.error\('Scheduled turn stale-lock watchdog failed'/);
  assert.match(source, /const response = await executeScheduledWorldTurnWithReconciliation\(\)/);
});
