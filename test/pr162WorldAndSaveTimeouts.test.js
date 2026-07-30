import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('World page uses the compact canonical fragment rather than the full save envelope', async () => {
  const source = await read('netlify/functions/shared-world.mjs');
  assert.match(source, /rpc\/get_manager_portal_world_fragment/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /canonical_world_saves\?world_id=.*select=\*/);
  assert.doesNotMatch(source, /stored\.save_envelope/);
  assert.doesNotMatch(source, /loadPersistentWorld/);
});

test('team save returns at the authoritative upsert boundary', async () => {
  const source = await read('netlify/functions/decisions.mjs');
  assert.match(source, /manager_turn_submissions\?on_conflict=/);
  assert.match(source, /The authoritative upsert is the success boundary/);
  assert.doesNotMatch(source, /await serverRest\('\/rest\/v1\/manager_messages'/);
  assert.doesNotMatch(source, /Could not create submission confirmation/);
});

test('team save verifies manager profile and appointment concurrently', async () => {
  const source = await read('netlify/functions/decisions.mjs');
  assert.match(source, /const \[profiles, appointments\] = await Promise\.all\(/);
  assert.match(source, /appointment\.manager_id !== manager\.id/);
});
