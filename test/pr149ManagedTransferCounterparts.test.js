import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('bilateral offers target active human-managed clubs only', async () => {
  const [legacyMigration, compactMigration, api, ui] = await Promise.all([
    read('supabase/migrations/20260728_pr149b_managed_transfer_clubs.sql'),
    read('supabase/migrations/20260811_compact_transfer_directory.sql'),
    read('netlify/functions/transfer-negotiations.mjs'),
    read('public/transfer-negotiations.js')
  ]);
  assert.match(legacyMigration, /get_managed_transfer_clubs/);
  assert.match(legacyMigration, /manager_id = public\.current_manager_id\(\)/);
  assert.match(legacyMigration, /appointment\.status = 'active'/);

  assert.match(compactMigration, /get_manager_transfer_directory_for_user/);
  assert.match(compactMigration, /appointment\.status = 'active'/);
  assert.match(compactMigration, /'managed', true/);
  assert.match(api, /get_manager_transfer_directory_for_user/);
  assert.doesNotMatch(api, /get_managed_transfer_clubs_for_user|managedClubIds\.has\(clubId\)/);
  assert.match(ui, /club\.managed/);
  assert.match(ui, /No other managed clubs available/);
});
