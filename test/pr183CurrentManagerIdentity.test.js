import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('current manager helper relies on caller RLS instead of owner privileges', async () => {
  const migration = await read('supabase/migrations/20260802_current_manager_id_security_invoker.sql');

  assert.match(migration, /create or replace function public\.current_manager_id\(\)/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /profile\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /set search_path = pg_catalog, public, auth/i);
});

test('current manager helper remains available only to signed-in and service roles', async () => {
  const migration = await read('supabase/migrations/20260802_current_manager_id_security_invoker.sql');

  assert.match(migration, /revoke all on function public\.current_manager_id\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.current_manager_id\(\) to authenticated, service_role/i);
  assert.match(migration, /current_manager_id must run as SECURITY INVOKER/i);
  assert.match(migration, /authenticated lost current_manager_id access required by RLS policies/i);
  assert.match(migration, /anon can execute current_manager_id/i);
});

test('rollback restores the previous security-definer helper exactly', async () => {
  const rollback = await read('supabase/rollback/20260802_current_manager_id_security_invoker_rollback.sql');

  assert.match(rollback, /security definer/i);
  assert.match(rollback, /set search_path = public/i);
  assert.match(rollback, /grant execute on function public\.current_manager_id\(\) to authenticated, service_role/i);
});
