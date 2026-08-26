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

test('starting a listed-player offer clears stale part-exchange selections', () => {
  assert.match(source, /#offerPlayersSelected \[data-remove-exchange-player\]/);
  assert.match(source, /forEach\(\(remove\) => remove\.click\(\)\)/);
});
