import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260903_manager_inbox_notification_delivery.sql', import.meta.url), 'utf8');
const notifications = fs.readFileSync(new URL('../public/manager-notifications.js', import.meta.url), 'utf8');

test('free-agent terminal outcomes feed both manager-facing channels', () => {
  assert.match(migration, /create trigger free_agent_offer_manager_outcome/i);
  assert.match(migration, /insert into public\.manager_messages/i);
  assert.match(migration, /insert into public\.manager_notifications/i);
  assert.match(migration, /Transfer window is closed at %/);
  assert.match(migration, /free_agent_offer_outcome_key/);
});

test('active human appointments get a deduplicated welcome in inbox and notifications', () => {
  assert.match(migration, /create trigger manager_appointment_welcome/i);
  assert.match(migration, /appointment_welcome_key/);
  assert.match(migration, /where a\.status='active' and a\.control_type='human'/i);
});

test('notification client uses the same shared authorization bridge as the portal', () => {
  assert.match(notifications, /tbgPortalAuth\?\.waitForAuthorization/);
  assert.match(notifications, /authorization: bearer/);
  assert.doesNotMatch(notifications, /localStorage\.key/);
  assert.match(notifications, /cache: 'no-store'/);
});
