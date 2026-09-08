import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const guard = fs.readFileSync(new URL('../public/team-selection-eligibility-guard.js', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../public/transfer-history.js', import.meta.url), 'utf8');
const projection = fs.readFileSync(new URL('../src/world/managerPortalProjection.js', import.meta.url), 'utf8');

test('fresh canonical squad players are reconciled into both legacy team selectors before board listeners run', () => {
  assert.match(guard, /function reconcileCanonicalSquadSelectors\(portal\)/);
  assert.match(guard, /appendMissingPlayerLabel\(startingXi, 'xi', player\)/);
  assert.match(guard, /appendMissingPlayerLabel\(bench, 'bench', player\)/);
  assert.match(guard, /window\.addEventListener\('tbg:portal-rendered',[\s\S]*reconcileCanonicalSquadSelectors\(lastPortal\);[\s\S]*\}, true\);/);
});

test('canonical transfer completion requests a fresh bootstrap for team selection', () => {
  assert.match(guard, /document\.addEventListener\('tbg:transfer-completed'/);
  assert.doesNotMatch(guard, /document\.addEventListener\('tbg:transfer-history-refresh'/);
  assert.match(guard, /fetch\('\/api\/bootstrap'/);
  assert.match(guard, /cache: 'no-store'/);
  assert.match(guard, /window\.tbgPortalAuthorization/);
});

test('transfer history announces newly completed deals and keeps checking while the portal remains open', () => {
  assert.match(history, /const announcedCompletedTransfers = new Set\(\)/);
  assert.match(history, /function announceNewCompletions\(rows\)/);
  assert.match(history, /row\?\.status === 'completed'/);
  assert.match(history, /new CustomEvent\('tbg:transfer-completed'/);
  assert.match(history, /announceNewCompletions\(rows\);/);
  assert.match(history, /window\.setInterval\([\s\S]*maybeMount\(false\);[\s\S]*TTL\);/);
});

test('missing matchday runtime state defaults to selectable condition in the manager projection', () => {
  assert.match(projection, /const condition = runtime\?\.state\?\.players\?\.\[playerId\] \|\| \{\}/);
  assert.match(projection, /const availability = runtime\?\.state\?\.availability\?\.players\?\.\[playerId\] \|\| \{\}/);
  assert.match(projection, /fitness: number\(condition\.fitness, 100\)/);
  assert.match(projection, /injury_status: injured \? 'Injured' : suspended \? 'Suspended' : 'Available'/);
});
