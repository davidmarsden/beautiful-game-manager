import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const guard = fs.readFileSync(new URL('../public/team-selection-eligibility-guard.js', import.meta.url), 'utf8');
const projection = fs.readFileSync(new URL('../src/world/managerPortalProjection.js', import.meta.url), 'utf8');

test('fresh canonical squad players are reconciled into both legacy team selectors before board listeners run', () => {
  assert.match(guard, /function reconcileCanonicalSquadSelectors\(portal\)/);
  assert.match(guard, /appendMissingPlayerLabel\(startingXi, 'xi', player\)/);
  assert.match(guard, /appendMissingPlayerLabel\(bench, 'bench', player\)/);
  assert.match(guard, /window\.addEventListener\('tbg:portal-rendered',[\s\S]*reconcileCanonicalSquadSelectors\(lastPortal\);[\s\S]*\}, true\);/);
});

test('completed transfer history refresh requests a fresh bootstrap for team selection', () => {
  assert.match(guard, /document\.addEventListener\('tbg:transfer-history-refresh'/);
  assert.match(guard, /fetch\('\/api\/bootstrap'/);
  assert.match(guard, /cache: 'no-store'/);
  assert.match(guard, /window\.tbgPortalAuthorization/);
});

test('missing matchday runtime state defaults to selectable condition in the manager projection', () => {
  assert.match(projection, /const condition = runtime\?\.state\?\.players\?\.\[playerId\] \|\| \{\}/);
  assert.match(projection, /const availability = runtime\?\.state\?\.availability\?\.players\?\.\[playerId\] \|\| \{\}/);
  assert.match(projection, /fitness: number\(condition\.fitness, 100\)/);
  assert.match(projection, /injury_status: injured \? 'Injured' : suspended \? 'Suspended' : 'Available'/);
});
