import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('command ledger retains manager-facing status, reasons and supersession metadata', async () => {
  const migration = await source('supabase/migrations/20260724_pr100_manager_command_history.sql');
  assert.match(migration, /outcome_reason text/);
  assert.match(migration, /outcome_details jsonb/);
  assert.match(migration, /superseded_by uuid/);
  assert.match(migration, /'superseded'/);
});

test('shared-world GET returns full command history for the authenticated manager', async () => {
  const endpoint = await source('netlify/functions/shared-world.mjs');
  assert.match(endpoint, /readCommandHistory/);
  assert.match(endpoint, /manager_world_commands/);
  assert.match(endpoint, /commands: commandRows\.map\(commandSummary\)/);
  assert.match(endpoint, /outcome_reason/);
  assert.match(endpoint, /processed_at/);
  assert.match(endpoint, /negotiation_state/);
  assert.match(endpoint, /terminal_at/);
});

test('scheduled processing finalises outcomes and inbox events transactionally', async () => {
  const scheduler = await source('netlify/functions/scheduled-world-turn.mjs');
  const workflowMigration = await source('supabase/migrations/20260725_pr115_canonical_command_workflows.sql');
  assert.match(scheduler, /\/rest\/v1\/rpc\/finalize_manager_world_command/);
  assert.match(scheduler, /p_reason: reason/);
  assert.match(scheduler, /p_details: details/);
  assert.match(scheduler, /p_related_player_id: playerId/);
  assert.doesNotMatch(scheduler, /\/rest\/v1\/manager_messages/);
  assert.doesNotMatch(scheduler, /requires negotiation resolution before application/);
  assert.match(workflowMigration, /'world_command_outcome'/);
  assert.match(workflowMigration, /insert into public\.manager_messages/);
  assert.match(workflowMigration, /on conflict do nothing/);
});

test('World view renders pending and processed request history', async () => {
  const controls = await source('public/world-controls.js');
  assert.match(controls, /Request history/);
  assert.match(controls, /renderCommandHistory/);
  assert.match(controls, /Awaiting the next shared-world checkpoint/);
  assert.match(controls, /command\.outcome_reason/);
  assert.match(controls, /command\.processed_at/);
});
