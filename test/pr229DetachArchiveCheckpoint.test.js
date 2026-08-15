import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260815_detach_match_archive_from_checkpoint.sql', import.meta.url);

test('canonical checkpoint cannot invoke match archive projection in its transaction', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /drop trigger if exists canonical_world_save_match_archive_refresh[\s\S]*on public\.canonical_world_saves/i);
  assert.doesNotMatch(sql, /drop function[\s\S]*refresh_canonical_match_archives_from_save/i, 'retain the projection function for explicit post-commit recovery/backfill');
});

test('production recovery status accepts reconciliation_required', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /reconciliation_required/);
  assert.match(sql, /world_turn_runs_status_check/);
});
