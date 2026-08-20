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

test('external world-membership lookup requires a fresh compact read model and preserves TM identity', async () => {
  const endpoint = await read('netlify/functions/external-market.mjs');
  const readModel = await read('src/world/worldReadModel.js');
  assert.match(endpoint, /world_read_model_cache\?world_id=/);
  assert.match(endpoint, /select=read_model,source_checksum/);
  assert.match(endpoint, /canonical_world_saves\?world_id=/);
  assert.match(endpoint, /select=save_checksum/);
  assert.match(endpoint, /cacheRow\.source_checksum !== canonicalRow\.save_checksum/);
  assert.match(endpoint, /World read model is refreshing; please retry shortly/);
  assert.doesNotMatch(endpoint, /canonical_world_saves\?[^`]*select=read_model/);
  assert.match(endpoint, /candidate\?\.transfermarkt_id/);
  assert.match(readModel, /transfermarkt_id: player\.transfermarkt_id \|\| player\.transfermarktId \|\| player\.transfermarkt_player_id \|\| null/);
});

test('external name search uses cached governed data, aliases and a fresh world projection', async () => {
  const endpoint = await read('netlify/functions/external-player-search.mjs');
  assert.match(endpoint, /PLAYER_DATABASE_URL/);
  assert.match(endpoint, /PLAYER_DATABASE_CACHE_MS/);
  assert.match(endpoint, /let playerDatabasePromise = null/);
  assert.match(endpoint, /async function playerDatabase/);
  assert.match(endpoint, /Date\.now\(\) - playerDatabaseLoadedAt < PLAYER_DATABASE_CACHE_MS/);
  assert.match(endpoint, /url\.searchParams\.get\('q'\)/);
  assert.match(endpoint, /function aliasesOf/);
  assert.match(endpoint, /row\.display_name/);
  assert.match(endpoint, /row\.full_name/);
  assert.match(endpoint, /row\.short_name/);
  assert.match(endpoint, /row\.nicknames/);
  assert.match(endpoint, /row\.nickname/);
  assert.match(endpoint, /row\.known_as/);
  assert.match(endpoint, /row\.common_name/);
  assert.match(endpoint, /row\.search_aliases/);
  assert.match(endpoint, /function profileAlias/);
  assert.match(endpoint, /profil\\\/spieler/);
  assert.match(endpoint, /decodeURIComponent\(slug\)/);
  assert.match(endpoint, /catch \{\s*return '';\s*\}/);
  assert.match(endpoint, /function scorePlayer/);
  assert.match(endpoint, /matched_alias: matchedAlias/);
  assert.match(endpoint, /aliases,/);
  assert.match(endpoint, /world_read_model_cache\?world_id=/);
  assert.match(endpoint, /cacheRow\.source_checksum !== canonicalRow\.save_checksum/);
  assert.match(endpoint, /in_world: inWorld/);
  assert.match(endpoint, /governed_rating_available/);
  assert.match(endpoint, /transfermarkt_id: tmId/);
  assert.match(endpoint, /lifecycle_status:/);
  assert.match(endpoint, /active_circulation:/);
});

test('external name search UI shows matched alias while retaining eligibility guards and TM-ID lookup', async () => {
  const ui = await read('public/external-market-ui.js');
  assert.match(ui, /Player name, nickname or Transfermarkt ID/);
  assert.match(ui, /Huguinho, Victor Hugo or 1364573/);
  assert.match(ui, /\/api\/external-player-search\?q=/);
  assert.match(ui, /data-select-external-player/);
  assert.match(ui, /function displayedExternalAliases/);
  assert.match(ui, /player\.matched_alias/);
  assert.match(ui, /Also known as:/);
  assert.match(ui, /Already in TBG world/);
  assert.match(ui, /Awaiting TBG rating/);
  assert.match(ui, /No governed player found/);
  assert.match(ui, /function externalPlayerUnavailable/);
  assert.match(ui, /player\.active_circulation === false/);
  assert.match(ui, /\['inactive', 'retired'\]\.includes\(lifecycle\)/);
  assert.match(ui, /externalPlayerUnavailable\(player\)/);
  assert.match(ui, /if \(\/\^\\d\+\$\/\.test\(query\)\) return lookupExternal\(query\)/);
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
