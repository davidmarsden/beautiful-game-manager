import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Ability history endpoint consumes the governed player-indexed projection', async () => {
  const source = await read('netlify/functions/player-rating-history.mjs');
  assert.match(source, /player-rating-history\.json/);
  assert.match(source, /\/auth\/v1\/user/);
  assert.match(source, /manager_profiles/);
  assert.match(source, /searchParams\.get\('player_id'\)/);
  assert.match(source, /payload|players/);
  assert.match(source, /cache-control': 'no-store/);
});

test('player profile keeps governed Ability history distinct from match statistics', async () => {
  const source = await read('public/player-profile.js');
  assert.match(source, /data-player-tab="statistics"/);
  assert.match(source, /data-player-tab="ability"/);
  assert.match(source, /Governed TBG Ability history/);
  assert.match(source, /Match-performance ratings remain in Statistics/);
  assert.match(source, /\/api\/player-rating-history\?player_id=/);
  assert.match(source, /if \(tab === 'ability'\) loadAbility\(panel, player\)/);
});

test('squad enhancer loads one indexed history and renders latest-change badges without broad observers', async () => {
  const source = await read('public/rating-history-enhancements.js');
  const links = await read('public/internal-profile-links.js');
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /latest_change/);
  assert.match(source, /ability-change/);
  assert.match(source, /dataset\.tbgPlayerId/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.match(links, /import '\.\/rating-history-enhancements\.js'/);
});
