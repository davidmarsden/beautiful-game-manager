import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('external market resolves governed TM identities before importing', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /PLAYER_DATABASE_URL/);
  assert.match(endpoint, /canonicalId\(tmId\)/);
  assert.match(endpoint, /resolveRated\(tmId\)/);
  assert.match(endpoint, /assertNotInWorld/);
  assert.match(endpoint, /Player is already registered to a club in this TBG world/);
});

test('unknown TM IDs use a durable targeted Apify import ledger', async () => {
  const migration = await read('supabase/migrations/20260820j_external_tm_imports.sql');
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(migration, /create table if not exists public\.external_player_imports/);
  assert.match(migration, /transfermarkt_id text not null unique/);
  assert.match(endpoint, /action === 'request_import'/);
  assert.match(endpoint, /playerIds: \[String\(tmId\)\]/);
  assert.match(endpoint, /status: 'scraping'/);
  assert.match(endpoint, /status: 'scraped'/);
  assert.match(endpoint, /rating_required/);
});

test('external acquisition is gated on a governed rating and reuses competitive player offers', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /This external player does not yet have a governed TBG Ability rating/);
  assert.match(endpoint, /submitFreeAgentOffer\(/);
  assert.match(endpoint, /acquisition_type: 'external_transfermarkt'/);
  assert.match(endpoint, /external_acquisition_fee_eur: value/);
  assert.match(endpoint, /expected_wage: freeAgentOfferExpectation\(player\)/);
});

test('external acquisition keeps distinct canonical event and history provenance', async () => {
  const acquisition = await read('src/squadCycle/freeAgentAcquisition.js');
  const migration = await read('supabase/migrations/20260820j_external_tm_imports.sql');
  assert.match(acquisition, /external_player_acquired/);
  assert.match(acquisition, /acquisition_fee_eur/);
  assert.match(migration, /external_transfermarkt_offer/);
  assert.match(migration, /External market/);
  assert.match(migration, /external_acquisition_fee_eur/);
});

test('external market UI supports lookup import status and competing contract offer', async () => {
  const ui = await read('public/external-market-ui.js');
  const bootstrap = await read('public/internal-profile-links.js');
  assert.match(bootstrap, /import '\.\/external-market-ui\.js'/);
  assert.match(ui, /\/api\/external-market\?tm_id=/);
  assert.match(ui, /data-request-external-import/);
  assert.match(ui, /Awaiting TBG rating/);
  assert.match(ui, /data-external-offer/);
  assert.match(ui, /Make offer/);
  assert.match(ui, /tbg-external-offer-request:/);
  assert.match(ui, /externalDecision\(data\.decision_at\)/);
});
