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

test('view switching is local and never reloads, navigates or refetches canonical state', async () => {
  const source = await read('public/portal-navigation.js');
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /location\.reload|location\.assign|location\.replace/);
  assert.doesNotMatch(source, /(?:window\.)?location\.(?:href|pathname|search|hash)\s*=/);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(source, /panel\.hidden = !active/);
  assert.match(source, /aria-selected/);
});

test('bootstrap projection is generation-safe and invalidated after manager writes', async () => {
  const cache = await read('public/portal-state-cache.js');
  const html = await read('public/index.html');
  assert.match(cache, /bootstrapRequest/);
  assert.match(cache, /bootstrapSnapshot/);
  assert.match(cache, /bootstrapGeneration/);
  assert.match(cache, /generation === bootstrapGeneration/);
  assert.match(cache, /responseFromSnapshot\(bootstrapSnapshot\)/);
  assert.match(cache, /invalidateBootstrapCache/);
  assert.match(cache, /window\.tbgInvalidateBootstrapCache = invalidateBootstrapCache/);
  assert.match(cache, /\/api\/decisions/);
  assert.match(cache, /\/api\/shared-world/);
  assert.doesNotMatch(cache, /tbg:portal-rendered/);
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
