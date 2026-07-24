import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('legacy processed commands receive truthful terminal outcome reasons', async () => {
  const migration = await source('supabase/migrations/20260724_pr101_backfill_command_outcomes.sql');
  assert.match(migration, /status in \('applied', 'rejected', 'cancelled', 'superseded'\)/);
  assert.match(migration, /when 'applied' then 'Request applied at its shared-world checkpoint\.'/);
  assert.match(migration, /when 'rejected' then 'Request was rejected during shared-world processing\.'/);
  assert.match(migration, /when 'cancelled' then 'Request was cancelled before application\.'/);
  assert.match(migration, /when 'superseded' then 'Request was replaced by a newer request\.'/);
  assert.match(migration, /outcome_reason is null or btrim\(outcome_reason\) = ''/);
  assert.match(migration, /legacy_outcome_backfill/);
});
