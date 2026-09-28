import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('portal cache exposes one generation-scoped state store without replacing legacy state', async () => {
  const source = await read('public/portal-state-cache.js');
  assert.match(source, /window\.tbgPortalStateStore = Object\.freeze/);
  assert.match(source, /get: getPortalState/);
  assert.match(source, /refresh: \(\) => getPortalState\(\{ force: true \}\)/);
  assert.match(source, /peek: \(\) => portalState/);
  assert.match(source, /portalState = null/);
  assert.doesNotMatch(source, /window\.tbgPortalState = Object\.freeze/);
});

test('team presets consume shared portal state and contain no independent bootstrap fetch or timer polling', async () => {
  const source = await read('public/team-presets.js');
  assert.match(source, /window\.tbgPortalStateStore\.get\(\)/);
  assert.match(source, /tbg:team-submission-saved/);
  assert.doesNotMatch(source, /fetch\(['"]\/api\/bootstrap/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => initialise/);
  assert.doesNotMatch(source, /1400|900/);
});
