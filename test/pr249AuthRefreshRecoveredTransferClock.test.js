import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('harmless Supabase auth events do not re-render an already running portal', async () => {
  const app = await read('public/app.js');
  assert.match(app, /supabase\.auth\.onAuthStateChange\(async \(event, nextSession\)/);
  assert.match(app, /const sameUser = Boolean\(previousSession\?\.user\?\.id && previousSession\.user\.id === session\.user\?\.id\)/);
  assert.match(app, /\['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'\]\.includes\(event\)/);
  assert.match(app, /if \(harmlessSessionRefresh\) return;/);
  assert.match(app, /youth_team_capacity \?\? 25/);
});

test('recovered legacy settlement failures retain their original agreement lifecycle clock', async () => {
  const sql = await read('supabase/migrations/20260819e_recovered_transfer_lifecycle_clock.sql');
  assert.match(sql, /event_type = 'application_failed'/);
  assert.match(sql, /event_type in \('accepted', 'amended'\)/);
  assert.match(sql, /failed_at > agreement_at/);
  assert.match(sql, /grace_expires_at = recovered\.agreement_at \+ interval '15 minutes'/);
  assert.match(sql, /binding_at = recovered\.agreement_at \+ interval '15 minutes'/);
  assert.match(sql, /settle_at = recovered\.agreement_at \+ interval '3 hours'/);
});
