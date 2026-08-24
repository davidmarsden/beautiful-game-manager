import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260824d_alpha_invite_email_delivery.sql');
const adminApi = read('netlify/functions/alpha-admin.mjs');
const adminUi = read('public/alpha-admin.js');

test('#291 records alpha invitation delivery without coupling it to invite creation', () => {
  assert.match(migration, /email_last_attempt_at/);
  assert.match(migration, /email_sent_at/);
  assert.match(migration, /email_message_id/);
  assert.match(migration, /email_last_error/);
  assert.match(migration, /admin_record_alpha_invite_email_delivery/);
  assert.match(adminApi, /admin_upsert_alpha_invite/);
  assert.match(adminApi, /sendAndTrackInvite/);
  assert.match(adminApi, /email_sent:\s*false/);
  assert.doesNotMatch(adminApi, /delete.*alpha_tester_invites/is);
});

test('#291 sends through Resend from a server-only Netlify secret', () => {
  assert.match(adminApi, /Netlify\?\.env\?\.get/);
  assert.match(adminApi, /RESEND_API_KEY/);
  assert.match(adminApi, /https:\/\/api\.resend\.com\/emails/);
  assert.match(adminApi, /The Beautiful Game <login@auth\.thebeautifulgame\.online>/);
  assert.doesNotMatch(adminUi, /RESEND_API_KEY/);
});

test('#291 invitation tells testers to use the invited identity and choose a club', () => {
  assert.match(adminApi, /Sign in with this same email address/);
  assert.match(adminApi, /choose from the vacant clubs made available to you/);
  assert.match(adminApi, /please try to break things/i);
  assert.match(adminApi, /screenshot is especially useful/i);
});

test('#291 preserves a successful Resend acceptance even if tracking persistence fails', () => {
  assert.match(adminApi, /let messageId/);
  assert.match(adminApi, /email_sent:\s*true/);
  assert.match(adminApi, /email_tracking_error/);
  assert.match(adminUi, /Do not resend unless you confirm delivery failed/);
});

test('#291 rejects resend for claimed or revoked invitations', () => {
  assert.match(adminApi, /invite\.status\s*!==\s*'invited'/);
  assert.match(adminApi, /invite_not_active/);
  assert.match(adminUi, /invite\.status\s*===\s*'invited'/);
});

test('#291 admin UI distinguishes saved, sent, failed and supports resend', () => {
  assert.match(adminUi, /email not sent/);
  assert.match(adminUi, /email failed:/);
  assert.match(adminUi, /email sent/);
  assert.match(adminUi, /action: 'resend_invite'/);
  assert.match(adminUi, /Invitation saved and email sent/);
  assert.match(adminUi, /Invitation saved, but email delivery failed/);
});
