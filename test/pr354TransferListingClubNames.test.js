import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260826g_transfer_listing_club_names.sql', import.meta.url), 'utf8');

test('transfer listings expose canonical club names to the UI', () => {
  assert.match(sql, /'club_name'/);
  assert.match(sql, /'seller_club_name'/);
  assert.match(sql, /left join public\.clubs club/i);
  assert.match(sql, /club\.name/i);
});

test('club ids remain present as stable identifiers while names are display fields', () => {
  assert.match(sql, /'club_id', listing\.club_id/);
  assert.match(sql, /'seller_club_id', listing\.club_id/);
});

test('transfer listing read path still uses compact lookup and avoids monolithic world reads', () => {
  assert.match(sql, /get_manager_transfer_lookup_for_user/);
  assert.doesNotMatch(sql, /world_read_model_cache/);
  assert.doesNotMatch(sql, /canonical_world_saves/);
});
