import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer market helpers avoid document-wide mutation observers', async () => {
  const [openMarket, external, freeAgents, history] = await Promise.all([
    read('public/open-market.js'),
    read('public/external-market-ui.js'),
    read('public/free-agent-offer-ui.js'),
    read('public/transfer-history.js')
  ]);

  for (const source of [openMarket, external, freeAgents, history]) {
    assert.doesNotMatch(source, /observe\(document\.documentElement/);
  }

  assert.doesNotMatch(openMarket, /new MutationObserver/);
  assert.doesNotMatch(external, /new MutationObserver/);
  assert.doesNotMatch(history, /new MutationObserver/);

  assert.match(openMarket, /tbg:portal-rendered/);
  assert.match(openMarket, /tbg:view-changed/);
  assert.match(openMarket, /scheduleOpenMarketMount/);

  assert.match(external, /tbg:portal-rendered/);
  assert.match(external, /tbg:view-changed/);
  assert.match(external, /data-open-market-tab="external"/);
  assert.match(external, /scheduleExternalCopy/);

  assert.match(freeAgents, /tbg:portal-rendered/);
  assert.match(freeAgents, /tbg:view-changed/);
  assert.match(freeAgents, /scheduleFreeAgentUi/);
  assert.match(freeAgents, /function observeOutgoingTransferRenders/);
  assert.match(freeAgents, /new MutationObserver\(\(\) => scheduleFreeAgentUi\(\)\)/);
  assert.match(freeAgents, /outgoingObserver\.observe\(outgoing, \{ childList: true \}\)/);

  assert.match(history, /tbg:portal-rendered/);
  assert.match(history, /tbg:view-changed/);
  assert.match(history, /scheduleHistoryMount/);
});

test('transfer UI reconciliation avoids unnecessary DOM rewrites', async () => {
  const [external, freeAgents] = await Promise.all([
    read('public/external-market-ui.js'),
    read('public/free-agent-offer-ui.js')
  ]);

  assert.match(external, /label\.firstChild\.nodeValue !== 'Player name, nickname or Transfermarkt ID'/);
  assert.match(external, /input\.placeholder !== 'e\.g\. Huguinho, Victor Hugo or 1364573'/);
  assert.match(freeAgents, /if \(host\.innerHTML !== html\) host\.innerHTML = html/);
});