import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260818f_first_class_transfer_responses.sql', import.meta.url);
const endpointUrl = new URL('../netlify/functions/transfer-deals.mjs', import.meta.url);
const uiUrl = new URL('../public/transfer-negotiations.js', import.meta.url);

test('first-class transfer responses are exact-revision, participant-gated and idempotent', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /respond_manager_transfer_deal_for_user/i);
  assert.match(sql, /p_revision_no integer/i);
  assert.match(sql, /current_revision_no <> p_revision_no/i);
  assert.match(sql, /offer revision is stale/i);
  assert.match(sql, /pg_advisory_xact_lock\(request_lock_key\)/i);
  assert.match(sql, /event\.request_key = p_request_key/i);
  assert.match(sql, /Your club is not a participant/i);
  assert.match(sql, /Your club has already approved this exact revision/i);
  assert.match(sql, /action_value not in \('accept', 'decline', 'counter'\)/i);
  assert.match(sql, /to service_role/i);
});

test('accept requires both clubs on one revision and stops at agreed rather than settling', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /insert into public\.transfer_deal_approvals[\s\S]*'approved'/i);
  assert.match(sql, /approvals_count = 2/i);
  assert.match(sql, /set status = 'agreed'/i);
  assert.doesNotMatch(sql, /set status = 'grace_period'/i);
  assert.doesNotMatch(sql, /set status = 'completed'/i);
  assert.doesNotMatch(sql, /save_envelope/i);
});

test('counter creates a new immutable revision and resets consent naturally', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /p_revision_no \+ 1/i);
  assert.match(sql, /straight_transfer_counter/i);
  assert.match(sql, /supersedes_revision_no/i);
  assert.match(sql, /insert into public\.transfer_deal_legs/i);
  assert.match(sql, /current_revision_no = new_revision\.revision_no/i);
  assert.match(sql, /event_type[\s\S]*countered/i);
  assert.doesNotMatch(sql, /delete from public\.transfer_deal_revisions/i);
  assert.doesNotMatch(sql, /delete from public\.transfer_deal_approvals/i);
});

test('market projection exposes response state and revision history to both clubs', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /requires_action/i);
  assert.match(sql, /response_state/i);
  assert.match(sql, /revision_history/i);
  assert.match(sql, /status in \('negotiating', 'agreed'\)/i);
  assert.match(sql, /buyer_club_id = club_id_value/i);
  assert.match(sql, /seller_club_id = club_id_value/i);
});

test('transfer gateway wires accept decline and counter with exact revision numbers', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /\['accept_offer', 'decline_offer', 'counter_offer'\]/);
  assert.match(source, /respond_manager_transfer_deal_for_user/);
  assert.match(source, /p_revision_no: revisionNo/);
  assert.match(source, /p_action: responseAction/);
  assert.match(source, /Counter-offer sent immediately/);
  assert.match(source, /ready for the grace-period stage/);
});

test('Transfers UI renders exact-revision response controls and derives badge counts from rendered cards', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /data-deal-response="accept_offer"/);
  assert.match(source, /data-deal-response="decline_offer"/);
  assert.match(source, /data-deal-response="counter_offer"/);
  assert.match(source, /data-revision-no/);
  assert.match(source, /data-counter-fee/);
  assert.match(source, /revision_history/);
  assert.match(source, /const incomingCount = renderIncoming\(\)/);
  assert.match(source, /const outgoingCount = renderOutgoing\(\)/);
  assert.match(source, /const listingCount = renderListings\(\)/);
  assert.match(source, /return cards\.length/);
  assert.doesNotMatch(source, /Awaiting first-class response controls/);
});
