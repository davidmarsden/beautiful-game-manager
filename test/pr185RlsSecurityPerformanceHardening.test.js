import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('RLS policies cache request identity without changing authorization joins', async () => {
  const migration = await read('supabase/migrations/20260805_rls_security_performance_hardening.sql');

  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /manager_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /join public\.manager_appointments ma on ma\.manager_id = mp\.id/i);
  assert.match(migration, /ma\.status = 'active'/i);
  assert.match(migration, /direct_auth_policy_count/i);
});

test('duplicate operation-alert SELECT policy is removed while admin ALL policy remains', async () => {
  const migration = await read('supabase/migrations/20260805_rls_security_performance_hardening.sql');

  assert.match(migration, /alter policy "admins manage operation alerts"/i);
  assert.match(migration, /p\.is_admin = true/i);
  assert.match(migration, /drop policy "admins read operation alerts"/i);
  assert.match(migration, /duplicate world_operation_alerts SELECT policy still exists/i);
});

test('server-only canonical projection is documented and asserted', async () => {
  const migration = await read('supabase/migrations/20260805_rls_security_performance_hardening.sql');

  assert.match(migration, /has_table_privilege\('anon', 'public\.manager_canonical_match_views', 'select'\)/i);
  assert.match(migration, /has_table_privilege\('authenticated', 'public\.manager_canonical_match_views', 'select'\)/i);
  assert.match(migration, /Server-only canonical match projection/i);
});

test('rollback restores direct auth evaluation and duplicate alert read policy', async () => {
  const rollback = await read('supabase/rollback/20260805_rls_security_performance_hardening_rollback.sql');

  assert.match(rollback, /replace\(policy_row\.qual, '\( SELECT auth\.uid\(\) AS uid\)', 'auth\.uid\(\)'\)/i);
  assert.match(rollback, /create policy "admins read operation alerts"/i);
  assert.match(rollback, /comment on table public\.manager_canonical_match_views is null/i);
});
