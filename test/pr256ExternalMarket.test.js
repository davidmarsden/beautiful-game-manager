import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('external market resolves governed TM identities before importing', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /PLAYER_DATABASE_URL/);
  assert.match(endpoint, /canonicalId\(tmId\)/);
  assert.match(endpoint, /resolveRated\(tmId/);
  assert.match(endpoint, /assertNotInWorld/);
  assert.match(endpoint, /Player is already registered to a club in this TBG world/);
});

test('governed player database is revalidated after a scraped import awaits rating publication', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /PLAYER_DATABASE_CACHE_MS/);
  assert.match(endpoint, /cache: 'no-store'/);
  assert.match(endpoint, /row\?\.status === 'scraped'/);
  assert.match(endpoint, /resolveRated\(tmId, \{ force: true \}\)/);
});

test('unknown TM IDs use a durable targeted Apify import ledger and failed imports can restart', async () => {
  const migration = await read('supabase/migrations/20260820j_external_tm_imports.sql');
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(migration, /create table if not exists public\.external_player_imports/);
  assert.match(migration, /transfermarkt_id text not null unique/);
  assert.match(endpoint, /action === 'request_import'/);
  assert.match(endpoint, /playerIds: \[String\(tmId\)\]/);
  assert.match(endpoint, /status: 'scraping'/);
  assert.match(endpoint, /status: 'scraped'/);
  assert.match(endpoint, /rating_required/);
  assert.match(endpoint, /async function restartImport/);
  assert.match(endpoint, /row\?\.status === 'failed'/);
  assert.match(endpoint, /Targeted Transfermarkt import restarted/);
  assert.match(endpoint, /completed_at: null/);
});

test('external acquisition is gated on a governed rating and reuses competitive player offers', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  assert.match(endpoint, /This external player does not yet have a governed TBG Ability rating/);
  assert.match(endpoint, /submitFreeAgentOffer\(/);
  assert.match(endpoint, /acquisition_type: 'external_transfermarkt'/);
  assert.match(endpoint, /external_acquisition_fee_eur: value/);
  assert.match(endpoint, /expected_wage: freeAgentOfferExpectation\(player\)/);
});

test('external acquisition keeps distinct canonical event and completed history provenance', async () => {
  const acquisition = await read('src/squadCycle/freeAgentAcquisition.js');
  const migration = await read('supabase/migrations/20260820j_external_tm_imports.sql');
  assert.match(acquisition, /external_player_acquired/);
  assert.match(acquisition, /acquisition_fee_eur/);
  assert.match(migration, /external_transfermarkt_offer/);
  assert.match(migration, /classify_player_acquisition_provenance/);
  assert.match(migration, /new\.acquisition_type := 'external'/);
  assert.match(migration, /get_manager_player_acquisition_history_for_user/);
  assert.match(migration, /external_player_acquired/);
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
