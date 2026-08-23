import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Open Market listings do not call the heavyweight transfer-deals read', async () => {
  const ui = await read('public/open-market.js');
  const endpoint = await read('netlify/functions/transfer-listings.mjs');
  const migration = await read('supabase/migrations/20260823a_lightweight_transfer_listings.sql');

  assert.match(ui, /openMarketRequest\('\/api\/transfer-listings'\)/);
  assert.doesNotMatch(ui, /refreshListings[\s\S]{0,300}openMarketRequest\('\/api\/transfer-deals'\)/);
  assert.match(endpoint, /get_manager_transfer_listings_for_user/);
  assert.doesNotMatch(endpoint, /get_manager_transfer_market_for_user|settleDueTransfers|get_manager_transfer_lifecycle_for_user|get_manager_transfer_exchange_legs_for_user|get_manager_transfer_agreed_changes_for_user/);

  assert.match(migration, /create or replace function public\.get_manager_transfer_listings_for_user/);
  assert.match(migration, /from public\.transfer_market_listings listing/);
  assert.doesNotMatch(migration, /transfer_deals|transfer_deal_revisions|revision_history|get_manager_transfer_market_for_user/);
  assert.match(migration, /revoke all on function public\.get_manager_transfer_listings_for_user\(uuid,text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_manager_transfer_listings_for_user\(uuid,text\)[\s\S]*to service_role/);
});
