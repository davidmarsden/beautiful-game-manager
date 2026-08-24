import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260824a_alpha_invite_club_claiming.sql');
const claimStateFix = read('supabase/migrations/20260824b_alpha_invite_claim_state_fix.sql');
const claimApi = read('netlify/functions/club-claim.mjs');
const adminApi = read('netlify/functions/alpha-admin.mjs');
const claimUi = read('public/club-claiming.js');
const adminUi = read('public/alpha-admin.js');
const authEntry = read('public/auth-entry.js');

test('#291 keeps club claiming invite-only and server-derived', () => {
  assert.match(migration, /alpha_tester_invites/i);
  assert.match(migration, /lower\(email\).*lower\(coalesce\(v_manager\.email/i);
  assert.match(migration, /status <> 'revoked'/);
  assert.match(claimApi, /authenticatedUser\(token\)/);
  assert.match(claimApi, /p_user_id: user\.id/);
  assert.doesNotMatch(claimApi, /p_user_id:\s*payload\./);
});

test('#291 preserves one-manager/one-club and race-safe claim boundaries', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /manager_already_appointed/);
  assert.match(migration, /club_taken/);
  assert.match(migration, /insert into public\.manager_appointments/);
  assert.match(migration, /on conflict do nothing/);
});

test('#291 keeps claim and admin mutation behind service-only RPCs', () => {
  assert.match(migration, /revoke all on function public\.claim_alpha_club_for_user\(uuid, text, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_alpha_club_for_user\(uuid, text, text\) to service_role/i);
  assert.match(migration, /grant execute on function public\.admin_reassign_alpha_appointment\(uuid, uuid, text, text\) to service_role/i);
  assert.match(claimStateFix, /grant execute on function public\.admin_upsert_alpha_invite\(uuid, text, text, text\[\]\) to service_role/i);
  assert.match(claimApi, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(adminApi, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('#291 admin recovery ends appointments instead of deleting history', () => {
  assert.match(migration, /set status = 'ended', ended_at = now\(\)/);
  assert.doesNotMatch(migration, /delete from public\.manager_appointments/i);
  assert.match(migration, /alpha_appointment_events/);
  assert.match(migration, /event_type, from_club_id, to_club_id/);
});

test('#291 preserves claimed invitation state while the claim appointment remains active', () => {
  assert.match(claimStateFix, /when alpha_tester_invites\.status = 'claimed'/);
  assert.match(claimStateFix, /a\.manager_id = alpha_tester_invites\.claimed_manager_id/);
  assert.match(claimStateFix, /a\.club_id = alpha_tester_invites\.claimed_club_id/);
  assert.match(claimStateFix, /a\.status = 'active'/);
  assert.match(claimStateFix, /then 'claimed'/);
  assert.match(claimStateFix, /else null/);
});

test('#291 gives invited unassigned managers a confirmation-based claim UI', () => {
  assert.match(authEntry, /import\("\.\/club-claiming\.js"\)/);
  assert.match(claimUi, /Choose your club/);
  assert.match(claimUi, /confirm\(`Claim \$\{club\.club_name\}/);
  assert.match(claimUi, /club_taken/);
  assert.match(claimUi, /window\.location\.reload\(\)/);
});

test('#291 provides admin invite, end and reassign controls', () => {
  assert.match(adminUi, /action: 'invite'/);
  assert.match(adminUi, /action: 'reassign'/);
  assert.match(adminUi, /action: 'end'/);
  assert.match(adminUi, /Controlled alpha admin reassignment/);
});

test('#291 refreshes the admin session before every API request', () => {
  assert.match(adminUi, /async function currentAccessToken\(\)/);
  assert.match(adminUi, /supabase\.auth\.getSession\(\)/);
  assert.match(adminUi, /const accessToken = await currentAccessToken\(\)/);
  assert.doesNotMatch(adminUi, /authorization: `Bearer \$\{session\.access_token\}`/);
});
