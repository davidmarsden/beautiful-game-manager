import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalRole, roleSuitability } from '../src/matchEngine/modules/PlayerQuality.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('engine keeps graded positional versatility rather than binary single-position eligibility', () => {
  const centreBack = { position: 'Centre-Back' };
  assert.equal(canonicalRole(centreBack), 'cb');
  assert.equal(roleSuitability(centreBack, 'cb'), 1);
  assert.equal(roleSuitability(centreBack, 'fb'), 0.96);
  assert.equal(roleSuitability(centreBack, 'dm'), 0.96);
  assert.equal(roleSuitability(centreBack, 'wing_back'), 0.96);
  assert.equal(roleSuitability(centreBack, 'st'), 0.84);
  assert.equal(roleSuitability(centreBack, 'gk'), 0.72);
});

test('portal exposes the same natural comfortable cover and emergency suitability tiers', async () => {
  const source = await read('public/position-versatility.js');
  assert.match(source, /tier: 'natural', factor: 1/);
  assert.match(source, /tier: 'comfortable', factor: 0\.96/);
  assert.match(source, /tier: 'cover', factor: 0\.91/);
  assert.match(source, /tier: 'unknown', factor: 0\.88/);
  assert.match(source, /tier: 'emergency', factor: 0\.84/);
  assert.match(source, /factor: 0\.72/);
  assert.match(source, /Comfortable:/);
  assert.match(source, /Cover:/);
  assert.match(source, /Can play: any role/);
  assert.match(source, /\['natural','comfortable','cover'\]\.includes\(tier\)/);
});

test('Team Selection shows slot-specific suitability without making emergency use look normal', async () => {
  const source = await read('public/position-versatility.js');
  assert.match(source, /const BOARD_ROLE/);
  assert.match(source, /versatility-natural/);
  assert.match(source, /versatility-comfortable/);
  assert.match(source, /versatility-cover/);
  assert.match(source, /versatility-emergency/);
  assert.match(source, /Emergency/);
  assert.match(source, /suitability-warning/);
});

test('positional versatility assets are loaded through the canonical portal enhancement chain', async () => {
  const loader = await read('public/position-versatility-loader.js');
  const chain = await read('public/internal-profile-links.js');
  assert.match(loader, /position-versatility\.css/);
  assert.match(loader, /import '\.\/position-versatility\.js'/);
  assert.match(chain, /import '\.\/position-versatility-loader\.js'/);
});
