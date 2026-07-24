import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production turn preflight repairs every club before first matchday', async () => {
  const helper = await source('src/world/scheduledTurnViability.js');
  const scheduler = await source('netlify/functions/scheduled-world-turn.mjs');
  assert.match(helper, /Object\.keys\(world\.squad_cycle\.clubs\)\.sort\(\)/);
  assert.match(helper, /executeAiSquadPlan\(world\.squad_cycle, \{ clubId, at: repairAt \}\)/);
  assert.match(helper, /hard_minimum_gap/);
  assert.match(helper, /registered_gap/);
  assert.match(scheduler, /prepareScheduledTurnViability\(world/);
});

test('failed viability reports identify clubs and positional gaps', async () => {
  const helper = await source('src/world/scheduledTurnViability.js');
  assert.match(helper, /Preseason squad check needs attention/);
  assert.match(helper, /club_name/);
  assert.match(helper, /coverage/);
  assert.match(helper, /registered senior players/);
});

test('failed unchanged worlds can be retried exactly once by an administrator', async () => {
  const endpoint = await source('netlify/functions/run-due-turn-now.mjs');
  assert.match(endpoint, /before\.turn_status === 'failed'/);
  assert.match(endpoint, /turn_status=eq\.failed/);
  assert.match(endpoint, /save_checksum=eq\./);
  assert.match(endpoint, /scheduled-turn-retry:/);
  assert.match(endpoint, /recovery_of_run_id/);
  assert.match(endpoint, /world_operation_events/);
});

test('failed processing unlocks manager submissions for a safe retry', async () => {
  const scheduler = await source('netlify/functions/scheduled-world-turn.mjs');
  assert.match(scheduler, /status=eq\.locked/);
  assert.match(scheduler, /status: 'submitted', locked_at: null/);
  assert.match(scheduler, /turn_status: 'failed'/);
});
