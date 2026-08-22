import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 atomic exchange response UI uses the dedicated responder for accept, counter and decline', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /\/api\/transfer-exchange-response/);
  assert.match(source, /action:\s*'counter'/);
  assert.match(source, /deal_id:\s*counterMode\.dealId/);
  assert.match(source, /revision_no:\s*counterMode\.revisionNo/);
  assert.match(source, /legs:\s*counterLegsFromComposer\(\)/);
  assert.doesNotMatch(source, /action:\s*'counter_offer'/);
});

test('#272 counter reuses the existing several-player composer and sends a complete replacement revision', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /receivePlayersSelected/);
  assert.match(source, /offerPlayersSelected/);
  assert.match(source, /data-exchange-contract-player/);
  assert.match(source, /receiveCash/);
  assert.match(source, /offerCash/);
  assert.match(source, /A counter-offer must include at least one player/);
  assert.match(source, /Send counter-offer/);
});

test('#272 unlock is driven by authoritative exchange revision metadata, not legacy lock text', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  const endpoint = await read('netlify/functions/transfer-exchange-response.mjs');
  assert.match(source, /loadExchangeState/);
  assert.match(source, /exchangeForDeal/);
  assert.match(source, /displayedRevision/);
  assert.match(source, /cardRevisionNo !== revisionNo/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.doesNotMatch(source, /response locked until atomic settlement is deployed/i);
  assert.match(endpoint, /request\.method === 'GET'/);
  assert.match(endpoint, /two_club_exchange_offer/);
  assert.match(endpoint, /two_club_exchange_counter/);
  assert.match(endpoint, /revision_type/);
});

test('#272 response rechecks the authoritative revision immediately before accept or decline', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /loadExchangeState\(\{ force: true \}\)/);
  assert.match(source, /Number\(offer\.revision_no\) !== revisionNo/);
  assert.match(source, /displayedRevision\(card\) !== revisionNo/);
  assert.match(source, /data-exchange-response=\"accept\"/);
  assert.match(source, /data-exchange-response=\"counter\"/);
  assert.match(source, /data-exchange-response=\"decline\"/);
});

test('#272 exchange overlay reuses the portal-wide bearer token bridge before storage fallback', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  const bridge = await read('public/portal-auth-bridge.js');
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(source, /window\.tbgPortalAuthorization/);
  assert.match(source, /startsWith\('bearer '\)/i);
  assert.match(source, /localStorage/);
});

test('#272 exchange bootstrap failures are visible but retry with bounded backoff instead of a mutation loop', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /BOOTSTRAP_RETRY_DELAYS_MS\s*=\s*\[1_000, 5_000, 15_000\]/);
  assert.match(source, /bootstrapFailures >= BOOTSTRAP_RETRY_DELAYS_MS\.length/);
  assert.match(source, /scheduleBootstrapRetry\(\)/);
  assert.match(source, /transferMessage\(error\.message\)/);
  assert.match(source, /status\.contains\(mutation\.target\)/);
  assert.match(source, /clearBootstrapRetry\(\)/);
});

test('#272 Manager loader includes the exchange response UI module', async () => {
  const loader = await read('public/internal-profile-links.js');
  assert.match(loader, /transfer-exchange-response-ui\.js/);
});
