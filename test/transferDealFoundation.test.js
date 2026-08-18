import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260818_transfer_deal_foundation.sql', import.meta.url);
const hardeningUrl = new URL('../supabase/migrations/20260818c_transfer_listing_concurrency_and_ownership.sql', import.meta.url);
const offerUrl = new URL('../supabase/migrations/20260818d_first_class_transfer_offers.sql', import.meta.url);
const legacyBridgeUrl = new URL('../supabase/migrations/20260818e_legacy_outgoing_transfer_bridge.sql', import.meta.url);
const endpointUrl = new URL('../netlify/functions/transfer-deals.mjs', import.meta.url);
const uiUrl = new URL('../public/transfer-negotiations.js', import.meta.url);
const navigationUrl = new URL('../public/portal-navigation.js', import.meta.url);

test('transfer deal foundation is first-class and separate from manager_world_commands', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'transfer_market_listings',
    'transfer_market_listing_events',
    'transfer_deals',
    'transfer_deal_revisions',
    'transfer_deal_participants',
    'transfer_deal_legs',
    'transfer_deal_approvals'
  ]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  assert.match(sql, /leg_type text not null check \(leg_type in \('cash', 'permanent_transfer', 'loan'\)\)/i);
  assert.match(sql, /'grace_period', 'binding', 'settling', 'completed'/i);
  assert.doesNotMatch(sql, /insert into public\.manager_world_commands/i);
});

test('live listings are service-gated, idempotent and validated against the current compact world model', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /unique\s*\(\s*world_id\s*,\s*manager_id\s*,\s*request_key\s*\)/i);
  assert.match(sql, /cache_row\.source_checksum <> canonical_checksum/i);
  assert.match(sql, /Only a player owned by the appointed club can be listed or withdrawn/i);
  assert.match(sql, /set_manager_transfer_listing_for_user/i);
  assert.match(sql, /revoke all on function public\.set_manager_transfer_listing_for_user[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.set_manager_transfer_listing_for_user[\s\S]*to service_role/i);
  assert.match(sql, /alter table public\.transfer_market_listings enable row level security/i);
});

test('listing hardening serializes identical retries and retires stale ownership listings', async () => {
  const sql = await readFile(hardeningUrl, 'utf8');
  assert.match(sql, /pg_advisory_xact_lock\(request_lock_key\)/i);
  assert.match(sql, /hashtextextended/i);
  assert.match(sql, /listing_row\.club_id <> club_id_value/i);
  assert.match(sql, /'ownership-change:' \|\| stale_listing\.id::text \|\| ':' \|\| canonical_checksum/i);
  assert.match(sql, /'reason', 'canonical_player_ownership_changed'/i);
  assert.match(sql, /read_model #>> array\['squad_cycle','players',listing\.player_id,'club_id'\][\s\S]*= listing\.club_id/i);
});

test('first-class offers use immutable revisions, participants, legs and an append-only event ledger', async () => {
  const sql = await readFile(offerUrl, 'utf8');
  assert.match(sql, /create table if not exists public\.transfer_deal_events/i);
  assert.match(sql, /event_type in \('offered', 'withdrawn'\)/i);
  assert.match(sql, /set_manager_transfer_offer_for_user/i);
  assert.match(sql, /insert into public\.transfer_deal_revisions/i);
  assert.match(sql, /insert into public\.transfer_deal_participants/i);
  assert.match(sql, /insert into public\.transfer_deal_legs/i);
  assert.match(sql, /insert into public\.transfer_deal_approvals/i);
  assert.match(sql, /status = 'withdrawn'/i);
  assert.match(sql, /Only the manager who made this offer can withdraw it/i);
  assert.match(sql, /Only a negotiating offer can be withdrawn/i);
  assert.match(sql, /revoke update, delete on table public\.transfer_deal_events from service_role/i);
  assert.match(sql, /array\['club_profiles',buyer_club_id,'club_name'\]/i);
  assert.match(sql, /array\['club_profiles',seller_club_id,'canonical_name'\]/i);
  assert.doesNotMatch(sql, /array\['directory','clubs'/i);
  assert.doesNotMatch(sql, /manager_world_commands/i);
});

test('legacy outgoing bridge exposes only unanswered buyer offers and withdraws through audited finalization', async () => {
  const sql = await readFile(legacyBridgeUrl, 'utf8');
  assert.match(sql, /get_manager_legacy_outgoing_transfer_offers_for_user/i);
  assert.match(sql, /offer\.manager_id = manager_id_value/i);
  assert.match(sql, /offer\.command_type = 'transfer_offer'/i);
  assert.match(sql, /offer\.status = 'pending'/i);
  assert.match(sql, /response\.referenced_command_id = offer\.id/i);
  assert.match(sql, /not exists/i);
  assert.match(sql, /withdraw_manager_legacy_transfer_offer_for_user/i);
  assert.match(sql, /Only a pending legacy transfer offer can be withdrawn/i);
  assert.match(sql, /already received a response and can no longer be withdrawn/i);
  assert.match(sql, /finalize_manager_world_command/i);
  assert.match(sql, /'superseded'/i);
  assert.match(sql, /'withdrawn'/i);
  assert.match(sql, /grant execute on function public\.withdraw_manager_legacy_transfer_offer_for_user[\s\S]*to service_role/i);
});

test('legacy outgoing bridge tolerates malformed historical fee and contract fields', async () => {
  const sql = await readFile(legacyBridgeUrl, 'utf8');
  assert.match(sql, /coalesce\(offer\.command_payload->>'fee', ''\) ~ '\^-\?\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$'/i);
  assert.match(sql, /else 0\s+end/i);
  assert.match(sql, /coalesce\(offer\.command_payload->>'contractYears', offer\.command_payload->>'contract_years', ''\) ~ '\^\[0-9\]\+\$'/i);
  assert.match(sql, /greatest\(1, least\([\s\S]*::integer, 5\)\)/i);
  assert.match(sql, /else 3\s+end/i);
  assert.doesNotMatch(sql, /coalesce\(\(offer\.command_payload->>'fee'\)::numeric, 0\)/i);
});

test('transfer-deals gateway supports opaque Supabase service keys and never reads save_envelope', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /const isJwt = \(value\) => String\(value \|\| ''\)\.split\('\.'\)\.length === 3/);
  assert.match(source, /headers:\s*\{[\s\S]*apikey: apiKey/);
  assert.match(source, /const serverSupabase = \(path, options = \{\}\) => requestSupabase\(path, \{[\s\S]*apiKey: SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /\.\.\.\(isJwt\(SUPABASE_SERVICE_ROLE_KEY\) \? \{ bearer: SUPABASE_SERVICE_ROLE_KEY \} : \{\}\)/);
  assert.match(source, /get_manager_transfer_market_for_user/);
  assert.match(source, /get_manager_legacy_outgoing_transfer_offers_for_user/);
  assert.match(source, /withdraw_manager_legacy_transfer_offer_for_user/);
  assert.match(source, /set_manager_transfer_listing_for_user/);
  assert.match(source, /set_manager_transfer_offer_for_user/);
  assert.match(source, /\['offer', 'withdraw_offer'\]/);
  assert.doesNotMatch(source, /save_envelope/i);
  assert.doesNotMatch(source, /manager_world_commands/i);
});

test('Transfers UI makes listing, offers and buyer withdrawal immediate without matchday commands', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /data-view = 'transfers'|dataset\.view = 'transfers'/);
  assert.match(source, /<h2>Transfers<\/h2>/);
  assert.match(source, /<h3>Outgoing offers<\/h3>/);
  assert.match(source, /data-withdraw-offer/);
  assert.match(source, /action: 'offer'/);
  assert.match(source, /action: 'withdraw_offer'/);
  assert.match(source, /action: 'list'/);
  assert.match(source, /action: 'withdraw'/);
  assert.match(source, /Offer sent immediately/);
  assert.match(source, /Transfer offer withdrawn immediately/);
  assert.doesNotMatch(source, /command_type: 'transfer_offer'/);
  assert.doesNotMatch(source, /command_type: 'transfer_listing'/);
});

test('outstanding legacy incoming offers retain their existing accept and decline path', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /data-legacy-transfer-response="accepted"/);
  assert.match(source, /data-legacy-transfer-response="declined"/);
  assert.match(source, /respondLegacyOffer\(button\.dataset\.proposalId, button\.dataset\.legacyTransferResponse\)/);
  assert.match(source, /request\('\/api\/transfer-negotiations', \{ proposal_id: proposalId, response \}\)/);
});

test('outstanding legacy outgoing offers are visible and withdrawable until a response exists', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /legacy_outgoing_offers/);
  assert.match(source, /data-withdraw-legacy-offer/);
  assert.match(source, /withdrawLegacyOffer\(legacyButton\.dataset\.proposalId\)/);
  assert.match(source, /action: 'withdraw_legacy_offer'/);
  assert.match(source, /Legacy transfer offer withdrawn immediately/);
});

test('portal navigation exposes Transfers as a first-class route', async () => {
  const source = await readFile(navigationUrl, 'utf8');
  assert.match(source, /\['transfers', 'transfers'\]/);
  assert.match(source, /button\.dataset\.view = 'transfers'/);
  assert.match(source, /section\.id = 'transfersView'/);
});
