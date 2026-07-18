import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('fixture runner commits player state through the finalisation RPC', async () => {
  const source = await read('netlify/functions/run-fixtures.mjs');

  assert.doesNotMatch(source, /rpc\/apply_match_state_changes/);
  assert.match(source, /rpc\/finalise_match_with_state/);
  assert.match(source, /state_run_key: application\?\.run_key \|\| null/);
  assert.match(source, /state_changes_json: application/);
});

test('database finalisation applies state and fixture result in one transaction', async () => {
  const migration = await read('supabase/migrations/20260718_atomic_match_state_finalisation.sql');
  const applyIndex = migration.indexOf('state_applied := public.apply_match_state_changes');
  const fixtureIndex = migration.indexOf("update public.fixtures\n  set status = 'played'");
  const standingsIndex = migration.indexOf('perform public.rebuild_competition_standings');

  assert.ok(applyIndex > -1, 'state application must occur inside the finalisation function');
  assert.ok(fixtureIndex > applyIndex, 'fixture finalisation must follow state application in the same function');
  assert.ok(standingsIndex > fixtureIndex, 'standings rebuild must remain in the same transaction');
  assert.match(migration, /if target_fixture\.status = 'played' then/);
  assert.match(migration, /already finalised with a different score/);
});
