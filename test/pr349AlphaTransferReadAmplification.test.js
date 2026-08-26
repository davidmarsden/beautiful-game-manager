import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hardening = read('supabase/migrations/20260826_alpha_transfer_read_amplification.sql');
const market = read('supabase/migrations/20260826b_alpha_transfer_market_lookup.sql');
const volatility = read('supabase/migrations/20260826c_alpha_transfer_lookup_volatility.sql');

const combined = `${hardening}\n${market}`;

test('alpha transfer read hardening uses the compact transfer directory cache', () => {
  assert.match(hardening, /manager_transfer_directory_cache/);
  assert.match(hardening, /get_manager_transfer_directory_for_user/);
  assert.match(hardening, /pg_advisory_xact_lock/);
  assert.match(hardening, /players_by_id/);
  assert.match(hardening, /clubs_by_id/);
});

test('hardened transfer RPC definitions do not read the monolithic world read model', () => {
  assert.doesNotMatch(combined, /world_read_model_cache/);
  assert.doesNotMatch(combined, /cache_row\.read_model/);
});

test('incident hot-path RPCs are all replaced by the compact lookup', () => {
  for (const functionName of [
    'get_manager_legacy_outgoing_transfer_offers_for_user',
    'get_manager_transfer_listings_for_user',
    'get_manager_transfer_exchange_legs_for_user',
    'get_manager_transfer_history_for_user',
    'get_world_transfer_register_for_user',
    'get_manager_transfer_market_for_user',
    'set_manager_transfer_listing_for_user'
  ]) {
    assert.match(combined, new RegExp(`create or replace function public\\.${functionName}\\(`));
  }
});

test('cache-refreshing read gateways are explicitly volatile', () => {
  for (const functionName of [
    'get_manager_transfer_lookup_for_user',
    'get_manager_legacy_outgoing_transfer_offers_for_user',
    'get_manager_transfer_listings_for_user',
    'get_manager_transfer_exchange_legs_for_user',
    'get_manager_transfer_history_for_user',
    'get_world_transfer_register_for_user',
    'get_manager_transfer_market_for_user'
  ]) {
    assert.match(volatility, new RegExp(`alter function public\\.${functionName}`));
  }
});
