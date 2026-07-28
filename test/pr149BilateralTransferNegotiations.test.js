import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer responses are bound to an authoritative incoming offer', async () => {
  const migration = await read('supabase/migrations/20260728_pr149_bilateral_transfer_negotiations.sql');
  assert.match(migration, /referenced_command_id uuid references public\.manager_world_commands/);
  assert.match(migration, /get_manager_transfer_inbox/);
  assert.match(migration, /submit_manager_transfer_response/);
  assert.match(migration, /offer\.command_type = 'transfer_offer'/);
  assert.match(migration, /offer\.status = 'pending'/);
  assert.match(migration, /Transfer offer is not addressed to the appointed club/);
  assert.match(migration, /unique index[\s\S]*manager_world_commands_transfer_response_uidx/);
});

test('response payload inherits player club fee and contract from the proposal', async () => {
  const migration = await read('supabase/migrations/20260728_pr149_bilateral_transfer_negotiations.sql');
  assert.match(migration, /player_id_value := coalesce\(proposal\.command_payload/);
  assert.match(migration, /buyer_club_id := proposal\.club_id/);
  assert.match(migration, /'direction', 'sell'/);
  assert.match(migration, /'fee', coalesce/);
  assert.match(migration, /'contractYears'/);
  assert.doesNotMatch(migration, /p_player_id|p_other_club_id|p_fee/);
});

test('terminal response closes both sides atomically with audit and inbox outcomes', async () => {
  const migration = await read('supabase/migrations/20260728_pr149_bilateral_transfer_negotiations.sql');
  assert.match(migration, /propagate_transfer_response_outcome/);
  assert.match(migration, /after update of status on public\.manager_world_commands/);
  assert.match(migration, /proposal_state := 'accepted_applied'/);
  assert.match(migration, /proposal_state := 'declined'/);
  assert.match(migration, /accepted_application_failed/);
  assert.match(migration, /insert into public\.manager_command_audit/);
  assert.match(migration, /insert into public\.manager_messages/);
});

test('negotiation API exposes only the appointed club inbox and a compact football directory', async () => {
  const api = await read('netlify/functions/transfer-negotiations.mjs');
  assert.match(api, /get_manager_transfer_inbox/);
  assert.match(api, /submit_manager_transfer_response/);
  assert.match(api, /transferDirectory\(world, current\.appointment\.club_id\)/);
  assert.match(api, /incoming_offers/);
  assert.match(api, /cache-control': 'no-store'/);
  assert.doesNotMatch(api, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('manager portal provides club and player selectors plus explicit accept and decline controls', async () => {
  const [html, script, css] = await Promise.all([
    read('public/index.html'),
    read('public/transfer-negotiations.js'),
    read('public/transfer-negotiations.css')
  ]);
  assert.match(html, /transfer-negotiations\.css/);
  assert.match(html, /transfer-negotiations\.js/);
  assert.match(script, /Transfer negotiations/);
  assert.match(script, /negotiationClub/);
  assert.match(script, /negotiationPlayer/);
  assert.match(script, /data-transfer-response="accepted"/);
  assert.match(script, /data-transfer-response="declined"/);
  assert.match(script, /£\$\{Number\(offer\.fee/);
  assert.match(script, /next canonical checkpoint/);
  assert.match(css, /transfer-negotiation-grid/);
  assert.match(css, /@media\(max-width:560px\)/);
});
