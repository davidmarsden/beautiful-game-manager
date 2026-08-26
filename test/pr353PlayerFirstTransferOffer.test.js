import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/open-market.js', import.meta.url), 'utf8');

test('listed transfer CTA follows familiar player-first language', () => {
  assert.match(source, />Make offer<\/button>/);
  assert.match(source, /Choose a player first/);
  assert.doesNotMatch(source, />Prepare offer<\/button>/);
});

test('listed player offer is prepared in the first-class exchange composer', () => {
  assert.match(source, /document\.getElementById\('receivePlayer'\)/);
  assert.match(source, /receivePlayer\.value = playerId/);
  assert.match(source, /addReceivePlayer\.click\(\)/);
  assert.match(source, /offerCash\.value = openMarketMoney\(0\)/);
  assert.match(source, /submit\.textContent = 'Propose offer'/);
  assert.match(source, /Make offer for \$\{playerName\}/);
});

test('starting a listed-player offer clears every stale part-exchange selection from live DOM', () => {
  assert.match(source, /function clearStalePartExchangePlayers\(\)/);
  assert.match(source, /for \(let guard = 0; guard < 100; guard \+= 1\)/);
  assert.match(source, /document\.querySelector\('#offerPlayersSelected \[data-remove-exchange-player\]'\)/);
  assert.match(source, /remove\.click\(\)/);
  assert.match(source, /Could not clear the previous part-exchange draft/);
});

test('open-market offer preparation owns the listing click and blocks the legacy document handler', () => {
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /prepareListedOffer\(prepare\)/);
  assert.match(source, /\[data-transfer-section="my"\]/);
});
