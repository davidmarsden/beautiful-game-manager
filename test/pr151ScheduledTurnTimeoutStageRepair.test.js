import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turns identify and persist the precise failing stage', async () => {
  const scheduler = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  assert.match(scheduler, /stageTracker\('claim_world'\)/);
  assert.match(scheduler, /tracker\.begin\('persist_canonical_checkpoint'\)/);
  assert.match(scheduler, /failing_stage: stageSnapshot\.stage/);
  assert.match(scheduler, /stage_elapsed_ms: stageSnapshot\.stage_elapsed_ms/);
  assert.match(scheduler, /stage_timings: stageSnapshot\.stage_timings/);
  assert.match(scheduler, /tbg-scheduled-world-turn-v1\.8/);
});

test('large canonical checkpoint writes use a checksum-guarded timeout RPC', async () => {
  const scheduler = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  const migration = await read('supabase/migrations/20260729_pr151_scheduled_checkpoint_timeout.sql');
  assert.match(scheduler, /rpc\/replace_canonical_world_checkpoint/);
  assert.match(scheduler, /p_previous_checksum: previousChecksum/);
  assert.match(scheduler, /if \(!checkpoint\?\.accepted\) throw new Error\('Canonical world changed during scheduled processing'\)/);
  assert.match(migration, /alter role service_role set statement_timeout = '90s'/);
  assert.doesNotMatch(migration, /function public\.replace_canonical_world_checkpoint[\s\S]*set statement_timeout/);
  assert.match(migration, /save_checksum = p_previous_checksum/);
  assert.match(migration, /turn_status = 'locking'/);
  assert.match(migration, /return jsonb_build_object\([\s\S]*'accepted', true/);
  assert.match(migration, /grant execute on function public\.replace_canonical_world_checkpoint\(text, text, jsonb\) to service_role/);
});

test('claim failures remain inside the tracked boundary and do not escape the world loop', async () => {
  const scheduler = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  const processWorld = scheduler.slice(scheduler.indexOf('async function processWorld'), scheduler.indexOf('export default async'));
  assert.match(processWorld, /let claimed = false;[\s\S]*try \{[\s\S]*const lockRows = await service/);
  assert.match(processWorld, /if \(lockRows\.length !== 1\) return \{ world_id: worldId, status: 'skipped'/);
  assert.match(processWorld, /claimed = true;/);
  assert.match(processWorld, /if \(claimed\) \{[\s\S]*turn_status: 'failed'/);
  assert.match(processWorld, /persistAutomaticFailure\([\s\S]*stageSnapshot/);
});
