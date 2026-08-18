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

test('negotiation API uses the compact managed-club transfer projection', async () => {
  const api = await read('netlify/functions/transfer-negotiations.mjs');
  assert.match(api, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/get_manager_transfer_directory_for_user'/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/get_manager_transfer_inbox_for_user'/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/submit_manager_transfer_response_for_user'/);
  assert.match(api, /p_user_id: current\.user\.id/);
  assert.match(api, /const directory = snapshot\.directory/);
  assert.match(api, /directory,/);
  assert.match(api, /projectOffer\(directory, row\)/);
  assert.match(api, /incoming_offers/);
  assert.match(api, /cache-control': 'no-store'/);
  assert.doesNotMatch(api, /get_managed_transfer_clubs_for_user/);
  assert.doesNotMatch(api, /loadPersistentWorld|save_envelope|readTransferSnapshot|transferDirectory\(world/);
});

test('compact transfer directory keeps status and football labels in one server projection', async () => {
  const migration = await read('supabase/migrations/20260811_compact_transfer_directory.sql');
  assert.match(migration, /get_manager_transfer_directory_for_user\(\s*p_user_id uuid,\s*p_world_id text/);
  assert.match(migration, /from public\.canonical_world_saves/);
  assert.match(migration, /appointment\.status = 'active'/);
  assert.match(migration, /'turn_status', stored\.turn_status/);
  assert.match(migration, /'clubs', clubs/);
  assert.match(migration, /'players', players/);
  assert.match(migration, /jsonb_array_elements_text/);
  assert.match(migration, /\~ '\^-\?\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$'/);
  assert.match(migration, /grant execute on function public\.get_manager_transfer_directory_for_user\(uuid, text\)[\s\S]*to service_role/);
  assert.match(migration, /authenticated can execute compact transfer directory directly/);
});

test('transfer response POST checks compact turn metadata and does not deserialize the canonical save', async () => {
  const api = await read('netlify/functions/transfer-negotiations.mjs');
  assert.match(api, /async function readTurnState[\s\S]*select=world_id,turn_status,save_checksum,updated_at&limit=1/);
  const stateIndex = api.indexOf('const stored = await readTurnState(token, current.appointment.world_id)');
  const postIndex = api.indexOf("if (request.method !== 'POST')");
  assert.ok(stateIndex >= 0 && postIndex > stateIndex, 'compact turn state should be shared by GET and POST before the POST branch');
  const postSource = api.slice(postIndex);
  assert.doesNotMatch(postSource, /loadPersistentWorld|save_envelope/);
  assert.match(api, /stored\.turn_status !== 'open'/);
  assert.match(postSource, /submit_manager_transfer_response_for_user/);
});

test('transfer RPC migration removes direct browser execution and grants only service gateways', async () => {
  const migration = await read('supabase/migrations/20260801_transfer_service_role_gateways.sql');
  assert.match(migration, /get_managed_transfer_clubs_for_user\(\s*p_user_id uuid,\s*p_world_id text/);
  assert.match(migration, /get_manager_transfer_inbox_for_user\(\s*p_user_id uuid,\s*p_world_id text/);
  assert.match(migration, /submit_manager_transfer_response_for_user\(\s*p_user_id uuid/);
  assert.match(migration, /where profile\.user_id = p_user_id/);
  assert.match(migration, /set_config\('request\.jwt\.claim\.sub', p_user_id::text, true\)/);
  assert.match(migration, /revoke all on function public\.get_managed_transfer_clubs\(text\)[\s\S]*authenticated/);
  assert.match(migration, /revoke all on function public\.get_manager_transfer_inbox\(text\)[\s\S]*authenticated/);
  assert.match(migration, /revoke all on function public\.submit_manager_transfer_response\(text, uuid, text, text\)[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function public\.get_managed_transfer_clubs_for_user\(uuid, text\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.get_manager_transfer_inbox_for_user\(uuid, text\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.submit_manager_transfer_response_for_user\(uuid, text, uuid, text, text\)[\s\S]*to service_role/);
});

test('shared-world command submission enforces transfer authority before writing the ledger', async () => {
  const api = await read('netlify/functions/shared-world.mjs');
  assert.match(api, /async function assertTransferCommand\(current, world, type, payload\)/);
  assert.match(api, /clubOwnsPlayer\(world, current\.appointment\.club_id, playerId\)/);
  assert.match(api, /readClubFragment\(world\.world_id, otherClubId\)/);
  assert.match(api, /clubOwnsPlayer\(targetWorld, otherClubId, playerId\)/);
  assert.match(api, /serverSupabase\(`\/rest\/v1\/manager_appointments\?world_id=eq\.\$\{encodeURIComponent\(world\.world_id\)\}&club_id=eq\.\$\{encodeURIComponent\(otherClubId\)\}&status=eq\.active&select=club_id&limit=1`\)/);
  assert.doesNotMatch(api, /userSupabase\(`\/rest\/v1\/manager_appointments\?world_id=eq\.\$\{encodeURIComponent\(world\.world_id\)\}&club_id=eq\.\$\{encodeURIComponent\(otherClubId\)\}/);
  assert.match(api, /Transfer offers may only target clubs with an active manager/);
  const validationIndex = api.indexOf('await assertTransferCommand(current, world, type, commandPayload);');
  const ledgerIndex = api.indexOf("serverSupabase('/rest/v1/rpc/submit_manager_world_command_for_user'");
  assert.ok(validationIndex >= 0 && ledgerIndex > validationIndex, 'transfer authority must be checked before ledger insertion');
});

test('manager portal provides transfer selectors and preserves retry-safe legacy responses', async () => {
  const [html, script, css] = await Promise.all([
    read('public/index.html'),
    read('public/transfer-negotiations.js'),
    read('public/transfer-negotiations.css')
  ]);
  assert.match(html, /transfer-negotiations\.css/);
  assert.match(html, /transfer-negotiations\.js/);
  assert.match(script, /<h2>Transfers<\/h2>/);
  assert.match(script, /negotiationClub/);
  assert.match(script, /negotiationPlayer/);
  assert.match(script, /data-legacy-transfer-response="accepted"/);
  assert.match(script, /data-legacy-transfer-response="declined"/);
  assert.match(script, /£\$\{Number\(offer\.fee/);
  assert.match(script, /remains on the legacy response path/);
  assert.match(script, /async function respondLegacyOffer/);
  assert.match(script, /document\.querySelectorAll\('\[data-legacy-transfer-response\]'\)[\s\S]*button\.disabled = true/);
  assert.match(script, /respondLegacyOffer[\s\S]*await request\('\/api\/transfer-negotiations'/);
  assert.match(script, /respondLegacyOffer[\s\S]*await refresh\(\{ force: true \}\)/);
  assert.match(script, /respondLegacyOffer[\s\S]*catch \(error\)[\s\S]*renderIncoming\(\)/);
  assert.match(css, /transfer-negotiation-grid/);
  assert.match(css, /@media\(max-width:560px\)/);
});
