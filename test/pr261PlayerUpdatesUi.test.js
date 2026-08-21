import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portal = await readFile(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../public/player-updates.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../netlify/functions/player-updates.mjs', import.meta.url), 'utf8');

test('Player Updates is a first-class portal view', () => {
  assert.match(portal, /import '\.\/player-updates\.js'/);
  assert.match(portal, /\['player updates', 'updates'\]/);
  assert.match(portal, /dataset\.view = 'updates'/);
  assert.match(portal, /section\.id = 'updatesView'/);
  assert.match(portal, /button\.textContent = 'Player Updates'/);
});

test('Player Updates consumes governed release projection without recalculating ratings', () => {
  assert.match(ui, /\/api\/player-updates/);
  assert.match(ui, /ratings_updates/);
  assert.match(ui, /new_players/);
  assert.match(ui, /Source & provenance/);
  assert.match(ui, /rating_model_version/);
  assert.match(ui, /Manager does not recalculate these ratings/);
  assert.doesNotMatch(ui, /MutationObserver/);
});

test('Player Updates revalidates after a bounded interval when revisited', () => {
  assert.match(ui, /PLAYER_UPDATES_REVALIDATE_MS = 30000/);
  assert.match(ui, /Date\.now\(\) - loadedAt < PLAYER_UPDATES_REVALIDATE_MS/);
  assert.match(ui, /loadedAt = Date\.now\(\)/);
  assert.match(ui, /loaded = false;\s*loadedAt = 0;/);
  assert.match(ui, /if \(view === 'updates'\) loadUpdates\(\)/);
});

test('Player Updates API is authenticated and reads the pinned data-repo release', () => {
  assert.match(api, /TBG_PLAYER_RELEASE_URL/);
  assert.match(api, /player-release-latest\.json/);
  assert.match(api, /authorization: `Bearer \$\{token\}`/);
  assert.match(api, /manager_profiles/);
  assert.match(api, /cache-control': 'no-store/);
});
