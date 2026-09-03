import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260903d_alpha_updates.sql','utf8');
const playerEndpoint=fs.readFileSync('netlify/functions/alpha-updates.mjs','utf8');
const adminEndpoint=fs.readFileSync('netlify/functions/alpha-updates-admin.mjs','utf8');
const portal=fs.readFileSync('public/alpha-updates.js','utf8');
const admin=fs.readFileSync('public/alpha-updates-admin.js','utf8');
const adminHtml=fs.readFileSync('public/alpha-updates-admin.html','utf8');
const authEntry=fs.readFileSync('public/auth-entry.js','utf8');

test('published Alpha Updates expose curated public summaries, not triage notes',()=>{
  assert.match(migration,/create table if not exists public\.alpha_updates/i);
  assert.match(migration,/public_summary text not null/i);
  const playerRpc=migration.slice(migration.indexOf('create or replace function public.get_alpha_updates_for_user'),migration.indexOf('create or replace function public.mark_alpha_update_read_for_user'));
  assert.doesNotMatch(playerRpc,/admin_note/i);
  assert.match(playerRpc,/attribution_name/i);
});

test('publishing is bundled into one world-feed item and one manager notification per update',()=>{
  assert.match(migration,/'alpha_update'::text/);
  assert.match(migration,/source_key[^\n]*metadata|alpha_update:/i);
  assert.match(migration,/insert into public\.manager_messages/i);
  assert.match(migration,/insert into public\.manager_notifications/i);
  assert.match(migration,/on conflict\(manager_id,dedupe_key\) do nothing/i);
});

test('admin candidates exclude records already marked as duplicate',()=>{
  assert.match(migration,/not ilike 'Duplicate of canonical report%'/i);
  assert.match(admin,/public_summary/);
  assert.match(admin,/credit tester/);
});

test('admin can add curated items that do not originate in feedback reports',()=>{
  assert.match(adminHtml,/Other changes/);
  assert.match(admin,/manualItems/);
  assert.match(admin,/report_id:null/);
  assert.match(adminEndpoint,/items\.length===0/);
});

test('player and admin endpoints require authenticated Supabase sessions',()=>{
  assert.match(playerEndpoint,/auth\/v1\/user/);
  assert.match(adminEndpoint,/auth\/v1\/user/);
  assert.match(playerEndpoint,/get_alpha_updates_for_user/);
  assert.match(adminEndpoint,/admin_save_alpha_update/);
});

test('manager portal loads What’s New with unread badge support',()=>{
  assert.match(authEntry,/alpha-updates\.js/);
  assert.match(portal,/What's New/);
  assert.match(portal,/unread_count/);
  assert.match(portal,/mark-read/);
});
