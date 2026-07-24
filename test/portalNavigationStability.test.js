import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('one authoritative controller owns every portal view transition', async () => {
  const source = await read('public/portal-navigation.js');
  assert.match(source, /document\.addEventListener\('click', handleNavigation, true\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /tbg:view-changed/);
  for (const view of ['dashboard', 'squad', 'tactics', 'schedule', 'competitions', 'world']) {
    assert.match(source, new RegExp(`\\['${view.replace('&', '\\&')}'`));
  }
});

test('view switching is local and never reloads or refetches canonical state', async () => {
  const source = await read('public/portal-navigation.js');
  assert.doesNotMatch(source, /fetch\(|location\.reload|window\.location/);
  assert.match(source, /panel\.hidden = !active/);
  assert.match(source, /aria-selected/);
});

test('bootstrap projection is cached and invalidated only after manager writes', async () => {
  const cache = await read('public/portal-state-cache.js');
  const html = await read('public/index.html');
  assert.match(cache, /bootstrapPromise/);
  assert.match(cache, /cachedResponse\(\)/);
  assert.match(cache, /\/api\/decisions/);
  assert.match(cache, /\/api\/shared-world/);
  assert.match(html, /portal-state-cache\.js/);
  assert.ok(html.indexOf('portal-state-cache.js') < html.indexOf('phase2d3.js'));
  assert.ok(html.indexOf('portal-navigation.js') > html.indexOf('world-controls.js'));
});

test('navigation controller covers menus and dashboard alert actions without duplicate work', async () => {
  const source = await read('public/portal-navigation.js');
  assert.match(source, /target\.closest\?\.\('\[data-view\], \[data-portal-view\]'\)/);
  assert.match(source, /explicit\.dataset\.view \|\| explicit\.dataset\.portalView/);
  assert.match(source, /document\.querySelectorAll\('\[data-view\], \[data-portal-view\]'\)/);
  assert.match(source, /target\.closest\?\.\('#clubNav a'\)/);
  assert.match(source, /VIEW_ALIASES/);
});