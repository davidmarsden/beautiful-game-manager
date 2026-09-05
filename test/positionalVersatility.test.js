import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalRole, roleSuitability, MODULE_B_FORMATION_SLOTS } from '../src/matchEngine/modules/PlayerQuality.js';

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

test('Team Selection uses Module B formation slot sequences rather than visual board labels', async () => {
  const source = await read('public/position-versatility.js');
  assert.deepEqual(MODULE_B_FORMATION_SLOTS['4-3-3-wide'], ['gk','fb','cb','cb','fb','dm','cm','cm','wing','st','wing']);
  assert.deepEqual(MODULE_B_FORMATION_SLOTS['3-5-2'], ['gk','cb','cb','cb','wing_back','cm','dm','cm','wing_back','st','st']);
  assert.match(source, /'4-3-3-wide': \['gk','fb','cb','cb','fb','dm','cm','cm','wing','st','wing'\]/);
  assert.match(source, /'3-5-2': \['gk','cb','cb','cb','wing_back','cm','dm','cm','wing_back','st','st'\]/);
  assert.match(source, /FORMATION_ROLES\[formation\]\?\.\[index\]/);
  assert.doesNotMatch(source, /const BOARD_ROLE/);
  assert.match(source, /versatility-natural/);
  assert.match(source, /versatility-comfortable/);
  assert.match(source, /versatility-cover/);
  assert.match(source, /versatility-emergency/);
});

test('portal role derivation follows Module B position field precedence', async () => {
  const source = await read('public/position-versatility.js');
  assert.match(source, /return player\.position\s*\n\s*\|\| player\.primary_position\s*\n\s*\|\| player\.position_name\s*\n\s*\|\| player\.position_detail\s*\n\s*\|\| player\.canonical_position\s*\n\s*\|\| player\.transfermarkt_position\s*\n\s*\|\| player\.position_group/);
  assert.doesNotMatch(source, /return player\.specific_position/);
  assert.equal(canonicalRole({ position: 'Defender', specific_position: 'Left-Back' }), 'cb');
});

test('clearing Can play restores the current rendered table before returning', async () => {
  const source = await read('public/position-versatility.js');
  assert.match(source, /rows\.forEach\(\(row\) => \{ row\.hidden = false; \}\)/);
  assert.match(source, /separators\.forEach\(\(row\) => \{ row\.hidden = false; \}\)/);
  const resetIndex = source.indexOf("rows.forEach((row) => { row.hidden = false; });");
  const returnIndex = source.indexOf("if (role === 'all') return;");
  assert.ok(resetIndex >= 0 && returnIndex > resetIndex);
});

test('Formation Board auto-pick maximises engine-adjusted slot quality instead of raw rating', async () => {
  const source = await read('public/position-versatility.js');
  assert.match(source, /function maximumWeightAssignment\(weights\)/);
  assert.match(source, /const fit = roleSuitability\(candidate\.role, requiredRole\)/);
  assert.match(source, /return candidate\.rating \* fit\.factor/);
  assert.match(source, /const assignment = maximumWeightAssignment\(weights\)/);
  assert.match(source, /requiredRole === 'gk' && hasGoalkeeper && candidate\.role !== 'gk'/);
  assert.match(source, /document\.addEventListener\('click', interceptAutoPick, true\)/);
  assert.match(source, /event\.target\?\.closest\?\.\('#autoPickFormation'\)/);
  assert.match(source, /new CustomEvent\('tbg:team-sheet-override'\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('positional versatility assets are loaded through the canonical portal enhancement chain', async () => {
  const loader = await read('public/position-versatility-loader.js');
  const chain = await read('public/internal-profile-links.js');
  assert.match(loader, /position-versatility\.css/);
  assert.match(loader, /import '\.\/position-versatility\.js'/);
  assert.match(chain, /import '\.\/position-versatility-loader\.js'/);
});
