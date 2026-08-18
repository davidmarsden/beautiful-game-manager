import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260818_transfer_deal_foundation.sql', import.meta.url);
const hardeningUrl = new URL('../supabase/migrations/20260818c_transfer_listing_concurrency_and_ownership.sql', import.meta.url);
const endpointUrl = new URL('../netlify/functions/transfer-deals.mjs', import.meta.url);
const uiUrl = new URL('../public/transfer-negotiations.js', import.meta.url);

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

test('transfer-deals gateway supports opaque Supabase service keys and never reads save_envelope', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /const isJwt = \(value\) => String\(value \|\| ''\)\.split\('\.'\)\.length === 3/);
  assert.match(source, /headers:\s*\{[\s\S]*apikey: apiKey/);
  assert.match(source, /const serverSupabase = \(path, options = \{\}\) => requestSupabase\(path, \{[\s\S]*apiKey: SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /\.\.\.\(isJwt\(SUPABASE_SERVICE_ROLE_KEY\) \? \{ bearer: SUPABASE_SERVICE_ROLE_KEY \} : \{\}\)/);
  assert.match(source, /get_manager_transfer_market_for_user/);
  assert.match(source, /set_manager_transfer_listing_for_user/);
  assert.doesNotMatch(source, /save_envelope/i);
  assert.doesNotMatch(source, /manager_world_commands/i);
});

test('World UI publishes and withdraws listings immediately instead of queuing transfer_listing commands', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /request\('\/api\/transfer-deals', \{\s*action: 'list'/);
  assert.match(source, /request\('\/api\/transfer-deals', \{\s*action: 'withdraw'/);
  assert.match(source, /Player listed immediately/);
  assert.match(source, /Transfer listing withdrawn immediately/);
  assert.doesNotMatch(source, /command_type: action === 'listing' \? 'transfer_listing'/);
  assert.doesNotMatch(source, /command_type: 'transfer_listing'/);
  assert.match(source, /command_type: 'transfer_offer'/);
});
