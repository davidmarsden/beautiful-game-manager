import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('portal bootstrap and team save use compact canonical fragment RPC', async () => {
  const [bootstrap, decisions] = await Promise.all([
    read('netlify/functions/bootstrap.mjs'),
    read('netlify/functions/decisions.mjs')
  ]);
  for (const source of [bootstrap, decisions]) {
    assert.match(source, /rpc\/get_manager_portal_world_fragment/);
    assert.doesNotMatch(source, /select=world_id,save_envelope/);
    assert.doesNotMatch(source, /loadPersistentWorld/);
  }
});

test('fragment migration excludes heavy world history and event payloads', async () => {
  const migration = await read('supabase/migrations/20260729_pr159_manager_portal_world_fragment.sql');
  assert.match(migration, /create or replace function public\.get_manager_portal_world_fragment/);
  assert.match(migration, /jsonb_object_agg\(entry\.key, entry\.value\)/);
  assert.match(migration, /'runtimes'/);
  assert.match(migration, /'player_ownership'/);
  assert.doesNotMatch(migration, /'event_ledger'/);
  assert.doesNotMatch(migration, /'history'/);
  assert.doesNotMatch(migration, /'checkpoints'/);
  assert.match(migration, /grant execute on function public\.get_manager_portal_world_fragment\(text, text\) to service_role/);
});

test('team save retains canonical fixture ownership and loan checks', async () => {
  const decisions = await read('netlify/functions/decisions.mjs');
  assert.match(decisions, /projectManagerPortal\(world, appointment\.club_id/);
  assert.match(decisions, /Fixture is not the canonical next fixture for this club/);
  assert.match(decisions, /const ownedPlayerIds = new Set/);
  assert.match(decisions, /player_not_owned/);
  assert.match(decisions, /createLoanEligibilitySnapshot/);
  assert.match(decisions, /ineligibleLoanPlayerIds/);
  assert.match(decisions, /buildManagerTurnSubmission/);
});
