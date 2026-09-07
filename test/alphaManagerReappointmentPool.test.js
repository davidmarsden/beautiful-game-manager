import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260907_manager_reappointment_pool_after_removal.sql', import.meta.url), 'utf8');

test('removed alpha managers move to a reappointment pool instead of becoming self-service invitees', () => {
  assert.match(migration, /status in \('invited','claimed','pool','revoked'\)/);
  assert.match(migration, /set status = 'pool', claimed_manager_id = null, claimed_club_id = null/);
  assert.match(migration, /v_invite\.status = 'pool'.*awaiting_reappointment/s);
});

test('self-service club claiming is limited to fresh explicit invitations', () => {
  assert.match(migration, /if v_invite\.status <> 'invited' then return jsonb_build_object\('ok', false, 'code', 'not_invited'\);/);
  assert.match(migration, /if v_invite\.status = 'pool' then return jsonb_build_object\('ok', false, 'code', 'awaiting_reappointment'\);/);
});

test('the production repair is semantic rather than tied to generated manager ids', () => {
  assert.match(migration, /Controlled-alpha inactivity after friendly warning and Monday deadline\./);
  assert.doesNotMatch(migration, /1026d3d1|e9d2ba29|d74d6706|28602c18|7663994b/);
});
