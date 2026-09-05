import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260905_alpha_update_delivery_integrity.sql', import.meta.url), 'utf8');

test('alpha update subjects do not duplicate an existing Alpha Update label', () => {
  assert.match(migration, /create or replace function public\.alpha_update_message_subject/);
  assert.match(migration, /lower\(trim\(coalesce\(p_title, ''\)\)\) like 'alpha update%'/);
  assert.match(migration, /then trim\(coalesce\(p_title, ''\)\)/);
  assert.match(migration, /else 'Alpha update: ' \|\| trim/);
});

test('alpha update inbox delivery is keyed uniquely by update and recipient', () => {
  assert.match(migration, /create unique index if not exists manager_messages_alpha_update_recipient_uidx/);
  assert.match(migration, /recipient_manager_id, \(\(metadata->>'alpha_update_id'\)\)/);
  assert.match(migration, /where message_type = 'alpha_update'/);
  assert.match(migration, /on conflict \(recipient_manager_id, \(\(metadata->>'alpha_update_id'\)\)\)/);
});

test('publication state independently drives all manager-facing delivery channels', () => {
  assert.match(migration, /create or replace function public\.deliver_published_alpha_update/);
  assert.match(migration, /insert into public\.world_feed_items/);
  assert.match(migration, /insert into public\.manager_messages/);
  assert.match(migration, /insert into public\.manager_notifications/);
  assert.match(migration, /a\.status = 'active'/);
  assert.match(migration, /m\.status = 'active'/);
});

test('deferred publication delivery re-reads the authoritative row at trigger execution', () => {
  assert.match(migration, /create constraint trigger alpha_updates_deliver_on_publish/);
  assert.match(migration, /after insert or update on public\.alpha_updates/);
  assert.match(migration, /deferrable initially deferred/);
  assert.match(migration, /select \* into v_update\s+from public\.alpha_updates\s+where id = new\.id/);
  assert.match(migration, /if not found or v_update\.status <> 'published' then/);
  assert.match(migration, /v_update\.world_id/);
  assert.match(migration, /v_update\.title/);
  assert.match(migration, /v_update\.summary/);
  assert.doesNotMatch(migration, /if tg_op = 'UPDATE' and old\.status = 'published' then/);
  assert.match(migration, /on conflict\(manager_id, dedupe_key\) do nothing/);
});

test('legacy alpha-update writers have their feed and inbox subjects normalised', () => {
  assert.match(migration, /manager_messages_normalise_alpha_update_subject/);
  assert.match(migration, /world_feed_normalise_alpha_update_subject/);
  assert.match(migration, /new\.subject := public\.alpha_update_message_subject/);
  assert.match(migration, /new\.title := public\.alpha_update_message_subject/);
});
