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

test('Ability history endpoint falls back to the published Pink Final projection when raw main has not committed it yet', async () => {
  const source = await read('netlify/functions/player-rating-history.mjs');
  assert.match(source, /raw\.githubusercontent\.com\/davidmarsden\/beautiful-game-data\/main\/derived\/player-changes\/player-rating-history\.json/);
  assert.match(source, /davidmarsden\.github\.io\/beautiful-game-data\/derived\/player-changes\/player-rating-history\.json/);
  assert.match(source, /if \(response\.status === 404\) continue/);
  assert.doesNotMatch(source, /response\.status === 404\) return \{ version: 'tbg-player-rating-history-v1'/);
});

test('player profile keeps governed Ability history distinct from match statistics', async () => {
  const source = await read('public/player-profile.js');
  assert.match(source, /data-player-tab="statistics"/);
  assert.match(source, /data-player-tab="ability"/);
  assert.match(source, /Governed TBG Ability history/);
  assert.match(source, /Match-performance ratings remain in Statistics/);
  assert.match(source, /\/api\/player-rating-history\?player_id=/);
  assert.match(source, /if \(tab === 'ability'\) loadAbility\(panel, player\)/);
  assert.match(source, /function abilityStillActive\(panel\)/);
  assert.match(source, /if \(!abilityStillActive\(panel\)\) return/);
});

test('squad enhancer loads one indexed history and renders safe latest-change badges without broad observers', async () => {
  const source = await read('public/rating-history-enhancements.js');
  const links = await read('public/internal-profile-links.js');
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /latest_change/);
  assert.match(source, /ability-change/);
  assert.match(source, /dataset\.tbgPlayerId/);
  assert.match(source, /document\.createElement\('span'\)/);
  assert.match(source, /badge\.title =/);
  assert.match(source, /badge\.textContent = marker/);
  assert.doesNotMatch(source, /insertAdjacentHTML\([\s\S]*changeBadge/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.match(links, /import '\.\/rating-history-enhancements\.js'/);
});

test('read-only squad renders publish a lifecycle event so Ability badges decorate club inspection and History squads', async () => {
  const squadView = await read('public/squad-view.js');
  const enhancer = await read('public/rating-history-enhancements.js');
  assert.match(squadView, /tbg:read-only-squad-rendered/);
  assert.match(squadView, /detail:\s*\{[^}]*\broot\b[^}]*\bplayers:\s*rows\b[^}]*\}/);
  assert.match(squadView, /data-tbg-player-id=/);
  assert.match(enhancer, /addEventListener\('tbg:read-only-squad-rendered'/);
  assert.match(enhancer, /detail\.root instanceof Element/);
});
