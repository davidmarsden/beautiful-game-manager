import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260922_manager_inactivity_enforcement.sql');
const worker = read('netlify/functions/manager-inactivity-enforcement-scheduled.mjs');

test('hard participation enforcement uses the published controlled-alpha 3/7/10 thresholds', () => {
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /interval '10 days'/);
  assert.match(migration, /manager_inactivity_checkins warning/);
  assert.match(migration, /warning\.status = 'sent'/);
  assert.match(migration, /Published operational dials: 3-day warning\/check-in, 7-day caretaker status, 10-day removal/);
});

test('caretaker status is recoverable and tracked separately from the appointment', () => {
  assert.match(migration, /create table if not exists public\.manager_participation_states/);
  assert.match(migration, /'caretaker'/);
  assert.match(migration, /Nothing is final yet|recover normal control/);
});

test('ten-day abandonment deterministically ends the appointment and returns the tester to the pool', () => {
  assert.match(migration, /set status = 'ended'/);
  assert.match(migration, /ended_at = now\(\)/);
  assert.match(migration, /set status = 'pool'/);
  assert.match(migration, /'manager_inactivity_enforcement'/);
  assert.match(migration, /'ended'/);
});

test('caretaker and removal both create dedicated notifications without duplicate generic email', () => {
  assert.match(migration, /'participation_caretaker'/);
  assert.match(migration, /'participation_removal'/);
  assert.match(migration, /manager_notification_email_deliveries/);
  assert.match(migration, /'skipped'/);
});

test('scheduled enforcement sends stage-specific operational email with bounded retries', () => {
  assert.match(worker, /claim_manager_inactivity_escalations/);
  assert.match(worker, /finish_manager_inactivity_escalation/);
  assert.match(worker, /RESEND_API_KEY/);
  assert.match(worker, /manager_inactivity_\$\{item\.stage\}/);
  assert.match(worker, /schedule: '30 \* \* \* \*'/);
  assert.match(migration, /attempts < 3/);
  assert.match(migration, /interval '15 minutes'/);
});

test('removal email preserves career history and explains reappointment', () => {
  assert.match(worker, /manager profile and career record remain/i);
  assert.match(worker, /reappointment pool/i);
  assert.match(worker, /club is now available for a replacement manager/i);
});


test('returning to the portal immediately clears caretaker state and the directory exposes it', () => {
  const participation = read('netlify/functions/manager-participation.mjs');
  const directory = read('public/manager-directory.js');
  assert.match(participation, /manager_participation_states\?manager_id=/);
  assert.match(participation, /method: 'DELETE'/);
  assert.match(participation, /participation_status/);
  assert.match(directory, /manager-directory-caretaker/);
  assert.match(directory, /participation_status/);
});
