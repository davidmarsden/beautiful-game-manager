import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('open market presents listed, free-agent and external discovery modes', async () => {
  const ui = await read('public/open-market.js');
  const loader = await read('public/internal-profile-links.js');

  assert.match(loader, /import '\.\/open-market-review-fixes\.js'/);
  assert.match(loader, /import '\.\/open-market\.js'/);
  assert.match(ui, /data-open-market-tab="listed"/);
  assert.match(ui, /data-open-market-tab="free-agents"/);
  assert.match(ui, /data-open-market-tab="external"/);
  assert.match(ui, /\/api\/transfer-deals/);
  assert.match(ui, /\/api\/free-agents/);
});

test('free-agent cards expose contract and wage terms and settle through the live signing API', async () => {
  const ui = await read('public/open-market.js');

  assert.match(ui, /data-free-agent-years/);
  assert.match(ui, /data-free-agent-wage/);
  assert.match(ui, /action: 'sign'/);
  assert.match(ui, /contract_years: years/);
  assert.match(ui, /wage,/);
  assert.match(ui, /client_request_id:/);
  assert.match(ui, /tbg:transfer-history-refresh/);
});

test('external TM-ID lookup reuses canonical free agents and clearly marks genuine imports as pending next slice', async () => {
  const ui = await read('public/open-market.js');

  assert.match(ui, /tm_id=/);
  assert.match(ui, /external_import_required/);
  assert.match(ui, /no external import is needed/i);
  assert.match(ui, /External import is required/);
});

test('successful open-market signing can force transfer history to refresh immediately', async () => {
  const history = await read('public/transfer-history.js');
  assert.match(history, /tbg:transfer-history-refresh/);
  assert.match(history, /lastLoadedAt = 0/);
  assert.match(history, /maybeMount\(true\)/);
});

test('review hardening keeps signing retries idempotent, filters owned players and refreshes the whole portal', async () => {
  const fixes = await read('public/open-market-review-fixes.js');

  assert.match(fixes, /SIGN_REQUEST_PREFIX/);
  assert.match(fixes, /sessionStorage\.getItem\(key\)/);
  assert.match(fixes, /client_request_id: clientRequestId/);
  assert.match(fixes, /\/api\/history/);
  assert.match(fixes, /owned\.playerIds\.has\(playerId\)/);
  assert.match(fixes, /owned\.transfermarktIds\.has\(tmId\)/);
  assert.match(fixes, /window\.location\.reload\(\)/);
  assert.match(fixes, /RESTORE_TRANSFERS_KEY/);
  assert.match(fixes, /\[data-view="transfers"\]/);
});
