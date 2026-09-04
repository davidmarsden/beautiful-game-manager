import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('free-agent endpoint exposes a club-scoped pending-offer withdrawal path', async () => {
  const endpoint = await read('netlify/functions/free-agents.mjs');
  assert.match(endpoint, /async function withdrawManagerOffer\(current, offerId\)/);
  assert.match(endpoint, /world_id=eq\.\$\{encodeURIComponent\(current\.appointment\.world_id\)\}/);
  assert.match(endpoint, /club_id=eq\.\$\{encodeURIComponent\(current\.appointment\.club_id\)\}/);
  assert.match(endpoint, /status=eq\.pending/);
  assert.match(endpoint, /status: 'withdrawn'/);
  assert.match(endpoint, /decision_reason: 'manager_withdrew_offer'/);
  assert.match(endpoint, /action === 'withdraw'/);
  assert.match(endpoint, /offer_id \|\| body\.offerId/);
});

test('POST body is parsed once so adding withdrawal does not break normal offers', async () => {
  const endpoint = await read('netlify/functions/free-agents.mjs');
  const matches = endpoint.match(/request\.json\(\)/g) || [];
  assert.equal(matches.length, 1);
  assert.match(endpoint, /const body = request\.method === 'POST' \? await request\.json\(\)/);
  assert.match(endpoint, /if \(action !== 'offer'\)/);
});

test('all pending open-market offers are visible with weekly wage and cancellation', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /Your open-market offers/);
  assert.match(ui, /offerMoney\(offer\.wage\)\} \/ week/);
  assert.match(ui, /function offerSourceLabel\(offer\)/);
  assert.match(ui, /External player/);
  assert.match(ui, /Free agent/);
  assert.match(ui, /data-withdraw-open-market-offer/);
  assert.match(ui, />Cancel offer<\/button>/);
  assert.match(ui, /action: 'withdraw', offer_id: offerId/);
});

test('external offer submission immediately refreshes the shared outgoing-offer summary', async () => {
  const externalUi = await read('public/external-market-ui.js');
  const offerUi = await read('public/free-agent-offer-ui.js');
  assert.match(externalUi, /tbg:external-offer-submitted/);
  assert.match(offerUi, /document\.addEventListener\('tbg:external-offer-submitted'/);
  assert.match(offerUi, /scheduleFreeAgentUi\(\{ refresh: true \}\)/);
  assert.match(offerUi, /data-open-market-outgoing-summary/);
});
