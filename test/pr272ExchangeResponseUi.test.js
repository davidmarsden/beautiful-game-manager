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

test('#272 unlock is scoped to cards deliberately locked by the earlier atomic-settlement fence', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /response locked until atomic settlement is deployed/i);
  assert.match(source, /data-exchange-response=\"accept\"/);
  assert.match(source, /data-exchange-response=\"counter\"/);
  assert.match(source, /data-exchange-response=\"decline\"/);
});

test('#272 Manager loader includes the exchange response UI module', async () => {
  const loader = await read('public/internal-profile-links.js');
  assert.match(loader, /transfer-exchange-response-ui\.js/);
});
