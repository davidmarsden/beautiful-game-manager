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

test('match reveal records manager state against the compact archive', async () => {
  const source = await read('netlify/functions/reveal-match.mjs');
  assert.match(source, /canonical_match_archives/);
  assert.match(source, /manager_match_views\?on_conflict=manager_id,fixture_id/);
  assert.doesNotMatch(source, /canonical_world_saves/);
  assert.doesNotMatch(source, /loadPersistentWorld/);
});

test('canonical save updates refresh an RLS-protected match archive', async () => {
  const migration = await read('supabase/migrations/20260802_canonical_match_archive_fast_path.sql');
  assert.match(migration, /create table if not exists public\.canonical_match_archives/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /appointed managers can read canonical match archives/);
  assert.match(migration, /after insert or update of save_envelope/);
  assert.match(migration, /on conflict \(fixture_id\) do update/);
  assert.match(migration, /set search_path = ''/);
});
