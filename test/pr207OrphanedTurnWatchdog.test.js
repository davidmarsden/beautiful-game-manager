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
    read('supabase/migrations/20260812_service_key_stale_turn_recovery.sql')
  ]);

  assert.match(source, /p_requested_by: null/);
  assert.doesNotMatch(source, /PATCH[\s\S]*turn_status/);
  assert.match(migration, /v_world\.save_checksum <> p_expected_checksum or v_world\.updated_at <> p_expected_updated_at/);
  assert.match(migration, /if v_age < p_lease/);
  assert.match(migration, /set status = 'submitted', locked_at = null/);
  assert.match(migration, /set status = 'failed', error_message = v_reason, completed_at = p_now/);
  assert.match(migration, /set turn_status = 'failed', updated_at = p_now/);
});

test('stale-lock RPC supports modern service keys without weakening its database grants', async () => {
  const migration = await read('supabase/migrations/20260812_service_key_stale_turn_recovery.sql');

  assert.doesNotMatch(migration, /request\.jwt\.claim\.role|service role required/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.recover_stale_canonical_turn_lock[\s\S]*from public/);
  assert.match(migration, /revoke all on function public\.recover_stale_canonical_turn_lock[\s\S]*from anon/);
  assert.match(migration, /revoke all on function public\.recover_stale_canonical_turn_lock[\s\S]*from authenticated/);
  assert.match(migration, /grant execute on function public\.recover_stale_canonical_turn_lock[\s\S]*to service_role/);
});

test('watchdog failure cannot block unrelated open worlds', async () => {
  const source = await read('netlify/functions/scheduled-world-turn-background.mjs');
  assert.match(source, /try \{[\s\S]*recoverAbandonedScheduledTurns[\s\S]*\} catch \(error\) \{[\s\S]*console\.error\('Scheduled turn stale-lock watchdog failed'/);
  assert.match(source, /const response = await executeScheduledWorldTurnWithReconciliation\(\)/);
});

test('one stale-lock RPC failure cannot prevent later locking worlds being attempted', async () => {
  const source = await read('netlify/functions/scheduled-world-turn-background.mjs');
  const loopIndex = source.indexOf('for (const world of Array.isArray(lockingWorlds) ? lockingWorlds : [])');
  const rpcIndex = source.indexOf("await service('/rest/v1/rpc/recover_stale_canonical_turn_lock'", loopIndex);
  const catchIndex = source.indexOf('} catch (error) {', rpcIndex);
  const returnIndex = source.indexOf('return recovered;', catchIndex);

  assert.ok(loopIndex >= 0 && rpcIndex > loopIndex, 'recovery RPC must run inside the per-world loop');
  assert.ok(catchIndex > rpcIndex && returnIndex > catchIndex, 'per-world RPC errors must be caught before the sweep returns');
  assert.match(source.slice(catchIndex, returnIndex), /Scheduled turn stale-lock recovery failed for world/);
  assert.match(source.slice(catchIndex, returnIndex), /world_id: world\.world_id/);
});
