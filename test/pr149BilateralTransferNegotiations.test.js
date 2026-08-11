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

test('negotiation API exposes only the appointed club inbox and a compact managed-club football directory', async () => {
  const api = await read('netlify/functions/transfer-negotiations.mjs');
  assert.match(api, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/get_manager_transfer_inbox_for_user'/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/get_managed_transfer_clubs_for_user'/);
  assert.match(api, /serverSupabase\('\/rest\/v1\/rpc\/submit_manager_transfer_response_for_user'/);
  assert.match(api, /p_user_id: current\.user\.id/);
  assert.match(api, /const managedClubIds = new Set/);
  assert.match(api, /transferDirectory\(world, current\.appointment\.club_id, managedClubIds\)/);
  assert.match(api, /incoming_offers/);
  assert.match(api, /cache-control': 'no-store'/);
  assert.doesNotMatch(api, /userSupabase\('\/rest\/v1\/rpc\/(get_manager_transfer_inbox|get_managed_transfer_clubs|submit_manager_transfer_response)'/);
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

test('manager portal provides selectors controls and retry-safe transfer responses', async () => {
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
  assert.match(script, /async function respond[\s\S]*finally \{[\s\S]*renderIncoming\(\);[\s\S]*\}/);
  assert.match(css, /transfer-negotiation-grid/);
  assert.match(css, /@media\(max-width:560px\)/);
});
