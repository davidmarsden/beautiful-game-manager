import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260818g_agreed_transfer_mutual_changes.sql', import.meta.url);
const endpointUrl = new URL('../netlify/functions/transfer-deals.mjs', import.meta.url);
const uiUrl = new URL('../public/transfer-negotiations.js', import.meta.url);

test('agreed transfer changes require mutual consent and preserve existing terms until accepted', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /transfer_deal_change_requests/i);
  assert.match(sql, /status = 'pending'/i);
  assert.match(sql, /Only an agreed transfer deal can be amended or mutually cancelled/i);
  assert.match(sql, /The proposing club cannot approve its own agreed-deal change/i);
  assert.match(sql, /action_value not in \('accept', 'reject'\)/i);
  assert.match(sql, /if action_value = 'reject'/i);
  assert.match(sql, /set status = 'rejected'/i);
});

test('agreed change proposal and response retries serialize before idempotency checks', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const proposalStart = sql.indexOf('create or replace function public.propose_manager_transfer_agreed_change_for_user');
  const responseStart = sql.indexOf('create or replace function public.respond_manager_transfer_agreed_change_for_user');
  const projectionStart = sql.indexOf('create or replace function public.get_manager_transfer_agreed_changes_for_user');
  const proposal = sql.slice(proposalStart, responseStart);
  const response = sql.slice(responseStart, projectionStart);
  assert.ok(proposal.indexOf('pg_advisory_xact_lock(request_lock_key)') < proposal.indexOf('requested_by_manager_id = manager_id_value'));
  assert.ok(response.indexOf('pg_advisory_xact_lock(request_lock_key)') < response.indexOf('responded_by_manager_id = manager_id_value'));
  assert.match(response, /'deal_status', deal_row\.status/i);
  assert.match(response, /'revision_no', deal_row\.current_revision_no/i);
  assert.match(response, /'idempotent', true/i);
});

test('accepted amendment creates a new immutable agreed revision with both club approvals', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /mutual_agreed_amendment/i);
  assert.match(sql, /deal_row\.current_revision_no \+ 1/i);
  assert.match(sql, /supersedes_revision_no/i);
  assert.match(sql, /insert into public\.transfer_deal_approvals/i);
  assert.match(sql, /requested_by_club_id[\s\S]*'approved'/i);
  assert.match(sql, /club_id_value[\s\S]*'approved'/i);
  assert.doesNotMatch(sql, /delete from public\.transfer_deal_revisions/i);
  assert.doesNotMatch(sql, /delete from public\.transfer_deal_approvals/i);
});

test('accepted cancellation terminates only by mutual consent', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /set status = 'mutually_cancelled'/i);
  assert.match(sql, /revoked_by_mutual_consent/i);
  assert.match(sql, /event_type[\s\S]*mutually_cancelled/i);
});

test('gateway exposes pending agreed changes and action routes', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /get_manager_transfer_agreed_changes_for_user/);
  assert.match(source, /pending_change/);
  assert.match(source, /propose_agreed_amendment/);
  assert.match(source, /propose_agreed_cancellation/);
  assert.match(source, /accept_agreed_change/);
  assert.match(source, /reject_agreed_change/);
  assert.match(source, /existing agreed terms remain in force/i);
});

test('Transfers UI formats money and renders mutual amendment and cancellation controls', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /formatMoney/);
  assert.match(source, /data-money-input/);
  assert.match(source, /Propose amendment/);
  assert.match(source, /Propose cancellation/);
  assert.match(source, /Agree to cancel/);
  assert.match(source, /Accept amendment/);
  assert.match(source, /Keep agreed deal/);
  assert.match(source, /data-agreed-change-action/);
});
