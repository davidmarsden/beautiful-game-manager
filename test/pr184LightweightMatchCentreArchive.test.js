import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('match centre reads the compact canonical archive instead of the world envelope', async () => {
  const source = await read('netlify/functions/match-centre.mjs');
  assert.match(source, /canonical_match_archives/);
  assert.doesNotMatch(source, /canonical_world_saves/);
  assert.doesNotMatch(source, /loadPersistentWorld/);
  assert.match(source, /archive_payload/);
});

test('archive match centre retains semantic reports and player performances', async () => {
  const source = await read('netlify/functions/match-centre.mjs');
  assert.match(source, /function rawRatingRows/);
  assert.match(source, /function performanceRows/);
  assert.match(source, /performance: performancesById\.get\(id\) \|\| null/);
  assert.match(source, /player_of_the_match: rated\[0\] \|\| null/);
  assert.match(source, /type === 'set_piece' && subtype === 'free_kick'/);
});

test('match reveal records manager state against the compact archive', async () => {
  const source = await read('netlify/functions/reveal-match.mjs');
  assert.match(source, /canonical_match_archives/);
  assert.match(source, /manager_canonical_match_views\?on_conflict=manager_id,fixture_id/);
  assert.match(source, /const revealedAt = existing\?\.revealed_at \|\| now/);
  assert.doesNotMatch(source, /revealed_at:\s*null/);
  assert.doesNotMatch(source, /canonical_world_saves/);
  assert.doesNotMatch(source, /loadPersistentWorld/);
});

test('canonical reveal state is keyed to canonical match archives', async () => {
  const migration = await read('supabase/migrations/20260802_canonical_match_archive_views.sql');
  assert.match(migration, /create table if not exists public\.manager_canonical_match_views/);
  assert.match(migration, /references public\.canonical_match_archives\(fixture_id\)/);
  assert.match(migration, /primary key \(manager_id, fixture_id\)/);
});

test('canonical save updates refresh an RLS-protected match archive', async () => {
  const migration = await read('supabase/migrations/20260802_canonical_match_archive_fast_path.sql');
  assert.match(migration, /create table if not exists public\.canonical_match_archives/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /appointed managers can read canonical match archives/);
  assert.match(migration, /after insert or update of save_envelope/);
  assert.match(migration, /on conflict \(fixture_id\) do update/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /nullif\(v_result->>'fixture_id', ''\)/);
  assert.match(migration, /if v_fixture_id is null then/);
});
