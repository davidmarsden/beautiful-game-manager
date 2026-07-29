import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stale canonical lock recovery is one service-role-only transaction', async () => {
  const sql = await read('supabase/migrations/20260729_pr155_atomic_stale_turn_lock_recovery.sql');
  assert.match(sql, /recover_stale_canonical_turn_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_world\.save_checksum <> p_expected_checksum/);
  assert.match(sql, /v_world\.updated_at <> p_expected_updated_at/);
  assert.match(sql, /v_age < p_lease/);
  assert.match(sql, /current_setting\('request\.jwt\.claim\.role'/);
  assert.match(sql, /service_role/);
  assert.match(sql, /update public\.manager_turn_submissions/);
  assert.match(sql, /update public\.world_turn_runs/);
  assert.match(sql, /update public\.canonical_world_saves/);
  assert.match(sql, /insert into public\.world_operation_events/);
});

test('stale recovery creates failed-run lineage when the worker died before run creation', async () => {
  const sql = await read('supabase/migrations/20260729_pr155_atomic_stale_turn_lock_recovery.sql');
  assert.match(sql, /if cardinality\(v_failed_runs\) = 0/);
  assert.match(sql, /insert into public\.world_turn_runs/);
  assert.match(sql, /'failed'/);
  assert.match(sql, /synthetic_failed_run/);
  assert.match(sql, /failed_run_id/);
});

test('only the background recovery entry point may invoke stale-lock repair', async () => {
  const background = await read('netlify/functions/run-due-turn-now-background.mjs');
  const synchronous = await read('netlify/functions/run-due-turn-now.mjs');
  assert.match(background, /rpc\/recover_stale_canonical_turn_lock/);
  assert.match(background, /p_expected_checksum/);
  assert.match(background, /p_expected_updated_at/);
  assert.match(background, /return runDueTurnNow\(request\)/);
  assert.doesNotMatch(synchronous, /recover_stale_canonical_turn_lock/);
});
