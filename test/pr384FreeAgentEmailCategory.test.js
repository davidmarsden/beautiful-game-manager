import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260903b_free_agent_email_category.sql', import.meta.url), 'utf8');

test('free-agent notifications use the transfer email preference bucket', () => {
  assert.match(migration, /like 'transfer_%'[\s\S]*like 'free_agent_%'[\s\S]*then 'transfers'/);
  assert.match(migration, /Transfer and free-agent activity share the Transfers preference/);
});
