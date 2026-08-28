import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828d_manager_notification_email_delivery.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/manager-notifications.mjs', import.meta.url), 'utf8');
const scheduled = fs.readFileSync(new URL('../netlify/functions/manager-notification-email-scheduled.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/manager-notifications.js', import.meta.url), 'utf8');

test('email delivery is explicit opt-in and scoped by manager plus world', () => {
  assert.match(migration, /email_frequency text not null default 'off'/);
  assert.match(migration, /primary key \(manager_id, world_id\)/);
  assert.match(migration, /email_start_at/);
  assert.match(migration, /notification\.created_at >= preference\.email_start_at/);
  assert.match(migration, /case when frequency_value = 'off' then null else now\(\) end/);
});

test('delivery preferences cover transfers social and system categories', () => {
  assert.match(migration, /like 'transfer_%' then 'transfers'/);
  assert.match(migration, /like 'news_%' then 'social'/);
  assert.match(migration, /email_transfers boolean not null default true/);
  assert.match(migration, /email_social boolean not null default true/);
  assert.match(migration, /email_system boolean not null default false/);
  assert.match(client, /Transfers — offers, counter-offers and outcomes/);
  assert.match(client, /News — comments and direct replies/);
  assert.match(client, /Game & system/);
});

test('manager notification API reads and updates delivery preferences', () => {
  assert.match(endpoint, /get_manager_notification_preferences_for_user/);
  assert.match(endpoint, /update-delivery-preferences/);
  assert.match(endpoint, /update_manager_notification_preferences_for_user/);
  assert.match(client, /data-tab="settings"/);
  assert.match(client, /email_frequency/);
  assert.match(client, /Daily digest/);
});

test('scheduled email worker claims deliveries and uses Resend', () => {
  assert.match(scheduled, /claim_manager_notification_email_deliveries/);
  assert.match(scheduled, /start_manager_notification_email_deliveries/);
  assert.match(scheduled, /finish_manager_notification_email_deliveries/);
  assert.match(scheduled, /https:\/\/api\.resend\.com\/emails/);
  assert.match(scheduled, /RESEND_API_KEY/);
  assert.match(scheduled, /schedule: '\*\/5 \* \* \* \*'/);
});

test('daily delivery groups manager notifications into a digest even for one item', () => {
  assert.match(scheduled, /items\[0\]\?\.email_frequency === 'daily'/);
  assert.match(scheduled, /const daily = new Map\(\)/);
  assert.match(scheduled, /daily\.get\(key\)\.push\(row\)/);
  assert.match(scheduled, /Your TBG update/);
});

test('stale claims do not consume retry attempts before delivery starts', () => {
  assert.match(migration, /select notification\.id, notification\.manager_id, 'sending', p_claim_token, now\(\), 0, now\(\), now\(\)/);
  assert.doesNotMatch(migration, /attempts = public\.manager_notification_email_deliveries\.attempts \+ 1/);
  assert.match(migration, /create or replace function public\.start_manager_notification_email_deliveries/);
  assert.match(migration, /set attempts = delivery\.attempts \+ 1,/);
  assert.match(scheduled, /start_manager_notification_email_deliveries[\s\S]*sendEmail/);
});

test('email delivery ledger uses bounded retry and browser roles cannot access privileged helpers', () => {
  assert.match(migration, /delivery\.attempts < 3/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /status in \('sending', 'sent', 'failed', 'skipped'\)/);
  assert.match(migration, /revoke all on table public\.manager_notification_preferences from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.manager_notification_email_deliveries from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.claim_manager_notification_email_deliveries\(uuid,integer\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.start_manager_notification_email_deliveries\(uuid,uuid\[\]\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.finish_manager_notification_email_deliveries\(uuid,uuid\[\],text,text\) from public, anon, authenticated/);
});
