import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const finance = fs.readFileSync(new URL('../public/finance.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../public/transfer-history.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/club-finance.mjs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260823c_transfer_history_authoritative_legs.sql', import.meta.url), 'utf8');

test('finance view exposes canonical cash and wage constraints', () => {
  assert.ok(navigation.includes("['finances', 'finance']"));
  assert.ok(navigation.includes('financeView'));
  assert.ok(finance.includes('/api/club-finance'));
  assert.ok(finance.includes('Cash balance'));
  assert.ok(finance.includes('Weekly wage bill'));
  assert.ok(finance.includes('Weekly wage budget'));
  assert.ok(finance.includes('Wage headroom'));
  assert.ok(endpoint.includes('clubFinanceSummary'));
  assert.ok(endpoint.includes('get_manager_portal_world_fragment'));
});

test('transfer history uses authoritative package legs', () => {
  assert.ok(history.includes('groupHistory'));
  assert.ok(history.includes('leg.from_club_name'));
  assert.ok(history.includes('leg.to_club_name'));
  assert.ok(history.includes('transfer-history-cash'));
  assert.ok(migration.includes("'legs'"));
  assert.ok(migration.includes('from_club_name'));
  assert.ok(migration.includes('to_club_name'));
  assert.ok(migration.includes('where leg.revision_id = revision_id'));
});
