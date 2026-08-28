import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828c_transfer_notifications.sql', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../public/transfer-history.js', import.meta.url), 'utf8');

test('authoritative transfer events feed manager notifications', () => {
  assert.match(migration, /after insert on public\.transfer_deal_events/);
  assert.match(migration, /'offered', 'countered', 'accepted', 'declined', 'settlement_completed'/);
  assert.match(migration, /source_type,[\s\S]*'transfer_deal_event'/);
  assert.match(migration, /on conflict\(manager_id, dedupe_key\) do nothing/);
});

test('offers and counters are actionable notifications for the other manager', () => {
  assert.match(migration, /'transfer_offer_received'/);
  assert.match(migration, /'transfer_counter_offer_received'/);
  assert.match(migration, /notification_class_value := 'action_required'/g);
  assert.match(migration, /participant\.manager_id <> new\.manager_id/);
});

test('accepted rejected and completed transfer outcomes are notified', () => {
  assert.match(migration, /'transfer_offer_accepted'/);
  assert.match(migration, /'transfer_offer_rejected'/);
  assert.match(migration, /'transfer_completed'/);
  assert.match(migration, /new\.event_type = 'settlement_completed'[\s\S]*or participant\.manager_id <> new\.manager_id/);
});

test('transfer notifications deep-link to the relevant live or historical deal', () => {
  assert.match(migration, /\?view=transfers&deal=/);
  assert.match(migration, /new\.deal_id::text/);
  assert.match(history, /new URLSearchParams\(window\.location\.search\)\.get\('deal'\)/);
  assert.match(history, /\[data-first-class-deal=/);
  assert.match(history, /data-transfer-history-deal=/);
  assert.match(history, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(history, /target\.style\.outline = '2px solid currentColor'/);
});

test('notification trigger helper is not browser executable', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /revoke all on function public\.emit_transfer_deal_notification\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.emit_transfer_deal_notification\(\) to service_role/);
});
