import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turns identify and persist the precise failing stage', async () => {
  const scheduler = await read('netlify/functions/scheduled-world-turn.mjs');
  assert.match(scheduler, /stageTracker\('claim_world'\)/);
  assert.match(scheduler, /tracker\.begin\('persist_canonical_checkpoint'\)/);
  assert.match(scheduler, /failing_stage: stageSnapshot\.stage/);
  assert.match(scheduler, /stage_elapsed_ms: stageSnapshot\.stage_elapsed_ms/);
  assert.match(scheduler, /stage_timings: stageSnapshot\.stage_timings/);
  assert.match(scheduler, /tbg-scheduled-world-turn-v1\.8/);
});

test('large canonical checkpoint writes use a checksum-guarded timeout RPC', async () => {
  const scheduler = await read('netlify/functions/scheduled-world-turn.mjs');
  const migration = await read('supabase/migrations/20260729_pr151_scheduled_checkpoint_timeout.sql');
  assert.match(scheduler, /rpc\/replace_canonical_world_checkpoint/);
  assert.match(scheduler, /p_previous_checksum: previousChecksum/);
  assert.match(scheduler, /if \(!checkpoint\?\.accepted\) throw new Error\('Canonical world changed during scheduled processing'\)/);
  assert.match(migration, /set statement_timeout = '90s'/);
  assert.match(migration, /save_checksum = p_previous_checksum/);
  assert.match(migration, /turn_status = 'locking'/);
  assert.match(migration, /return jsonb_build_object\([\s\S]*'accepted', true/);
  assert.match(migration, /grant execute on function public\.replace_canonical_world_checkpoint\(text, text, jsonb\) to service_role/);
});
