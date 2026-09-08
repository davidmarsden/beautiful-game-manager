import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260908_manager_inactivity_checkins.sql');
const scheduled = read('netlify/functions/manager-inactivity-checkin-scheduled.mjs');

test('inactivity check-ins wait three days and only target active human appointments', () => {
  assert.match(migration, /appointment\.status = 'active'/);
  assert.match(migration, /appointment\.control_type = 'human'/);
  assert.match(migration, /interval '3 days'/);
});

test('inactivity uses world-scoped portal activity before auth sign-in fallback', () => {
  assert.match(migration, /manager_world_activity activity/);
  assert.match(migration, /activity\.manager_id = appointment\.manager_id/);
  assert.match(migration, /activity\.world_id = appointment\.world_id/);
  assert.match(migration, /coalesce\(activity\.last_active_at, auth_user\.last_sign_in_at, appointment\.appointed_at\)/);
});

test('one check-in is created per appointment activity episode', () => {
  assert.match(migration, /unique \(appointment_id, activity_anchor\)/);
  assert.match(migration, /on conflict \(appointment_id, activity_anchor\) do nothing/);
  assert.match(migration, /manager_inactivity:/);
});

test('three-day check-in creates an in-app action-required notification without a duplicate generic email', () => {
  assert.match(migration, /'participation_inactivity'/);
  assert.match(migration, /'action_required'/);
  assert.match(migration, /We haven''t seen you for 3 days/);
  assert.match(migration, /manager_notification_email_deliveries/);
  assert.match(migration, /'skipped'/);
});

test('claim limit applies across new check-ins and retries', () => {
  assert.match(migration, /claim_limit integer/);
  assert.match(migration, /limit claim_limit/);
  assert.match(migration, /claim_limit - \(select count\(\*\) from inserted\)/);
});

test('scheduled worker sends operational email with bounded retries', () => {
  assert.match(scheduled, /claim_manager_inactivity_checkins/);
  assert.match(scheduled, /finish_manager_inactivity_checkin/);
  assert.match(scheduled, /RESEND_API_KEY/);
  assert.match(scheduled, /manager_inactivity_checkin/);
  assert.match(scheduled, /schedule: '15 \* \* \* \*'/);
  assert.match(migration, /attempts < 3/);
  assert.match(migration, /interval '15 minutes'/);
});

test('check-in is explicitly friendly rather than an automatic sacking notice', () => {
  assert.match(scheduled, /friendly participation check-in, not an automatic sacking notice/i);
  assert.match(scheduled, /published participation rules/i);
});
