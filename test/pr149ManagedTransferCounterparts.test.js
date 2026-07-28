import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('bilateral offers target active human-managed clubs only', async () => {
  const [migration, api, ui] = await Promise.all([
    read('supabase/migrations/20260728_pr149b_managed_transfer_clubs.sql'),
    read('netlify/functions/transfer-negotiations.mjs'),
    read('public/transfer-negotiations.js')
  ]);
  assert.match(migration, /get_managed_transfer_clubs/);
  assert.match(migration, /manager_id = public\.current_manager_id\(\)/);
  assert.match(migration, /appointment\.status = 'active'/);
  assert.match(api, /get_managed_transfer_clubs/);
  assert.match(api, /managedClubIds\.has\(clubId\)/);
  assert.match(ui, /club\.managed/);
  assert.match(ui, /No other managed clubs available/);
});
