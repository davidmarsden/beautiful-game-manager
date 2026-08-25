import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#333 loads the transfer section controller and keeps My Transfers as the default', async () => {
  const [loader, source] = await Promise.all([
    read('public/internal-profile-links.js'),
    read('public/transfer-section-cards.js')
  ]);

  assert.match(loader, /import '\.\/transfer-section-cards\.js';/);
  assert.match(source, /const DEFAULT_SECTION = 'my';/);
  assert.match(source, /\['my', 'My Transfers'/);
  assert.match(source, /\['market', 'Transfer Market'/);
  assert.match(source, /\['world', 'World Transfers'/);
  assert.match(source, /\['history', 'History'/);
  assert.match(source, /activeSection = DEFAULT_SECTION/);
});

test('#333 sections reuse existing transfer subsystem DOM instead of rebuilding it', async () => {
  const source = await read('public/transfer-section-cards.js');

  assert.match(source, /getElementById\('openMarketWorkspace'\)/);
  assert.match(source, /getElementById\('worldTransferRegisterPanel'\)/);
  assert.match(source, /getElementById\('firstClassTransferHistoryPanel'\)/);
  assert.match(source, /querySelector\('\.transfer-legacy-note'\)/);
  assert.match(source, /Array\.from\(transferGrid\.children\)/);
  assert.doesNotMatch(source, /fetch\(/);
});

test('#333 only shows the selected transfer section and handles late-mounted panels', async () => {
  const source = await read('public/transfer-section-cards.js');

  assert.match(source, /setHidden\(market, activeSection !== 'market'\)/);
  assert.match(source, /setHidden\(world, activeSection !== 'world'\)/);
  assert.match(source, /setHidden\(history, activeSection !== 'history'\)/);
  assert.match(source, /primaryItems\.forEach\(\(item\) => setHidden\(item, activeSection !== 'my'\)\)/);
  assert.match(source, /new MutationObserver\(\(\) => applyVisibility\(\)\)/);
  assert.match(source, /workspaceObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
});

test('#333 section cards expose accessible selected state and responsive card layouts', async () => {
  const source = await read('public/transfer-section-cards.js');

  assert.match(source, /aria-label', 'Transfer sections'/);
  assert.match(source, /aria-pressed=/);
  assert.match(source, /setAttribute\('aria-pressed'/);
  assert.match(source, /grid-template-columns: repeat\(4/);
  assert.match(source, /@media \(max-width: 820px\)/);
  assert.match(source, /@media \(max-width: 480px\)/);
});

test('#333 preparing a listed-player offer returns the manager to My Transfers', async () => {
  const source = await read('public/transfer-section-cards.js');

  assert.match(source, /\[data-open-market-prepare-offer\]/);
  assert.match(source, /queueMicrotask\(\(\) => selectSection\('my'\)\)/);
});
