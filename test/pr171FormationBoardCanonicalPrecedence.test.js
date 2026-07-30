import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('formation board owns canonical saved-team hydration without DOM mutation observers', async () => {
  const source = await read('public/formation-board.js');

  assert.match(source, /function normalisedSubmission\(state = window\.tbgPortalState\)/);
  assert.match(source, /startingXi\.length !== 11 \|\| bench\.length !== 7/);
  assert.match(source, /function applyCanonicalSubmission/);
  assert.match(source, /assignments = \[\.\.\.submission\.starting_xi\]/);
  assert.match(source, /benchAssignments = \[\.\.\.submission\.bench\]/);
  assert.match(source, /window\.addEventListener\('tbg:portal-rendered'/);
  assert.doesNotMatch(source, /new MutationObserver\(scheduleRefresh\)/);
  assert.doesNotMatch(source, /observe\(legacyXi/);
  assert.doesNotMatch(source, /observe\(legacyBench/);
});

test('late carried-forward selector churn cannot overwrite canonical board state', async () => {
  const source = await read('public/formation-board.js');

  assert.match(source, /let managerEdited = false/);
  assert.match(source, /if \(managerEdited \|\| !players\.length\) return false/);
  assert.match(source, /document\.addEventListener\('change'/);
  assert.match(source, /input\[data-zone="xi"\], input\[data-zone="bench"\]/);
  assert.match(source, /event\.isTrusted \|\| allowLegacyImport/);
  assert.match(source, /document\.addEventListener\('tbg:team-sheet-override', allowExplicitLegacyImport\)/);
});

test('manager edits and explicit team-sheet loads remain authoritative', async () => {
  const source = await read('public/formation-board.js');

  assert.match(source, /function markManagerEdited\(\)/);
  assert.match(source, /markManagerEdited\(\);\n  const target = zone === 'xi'/);
  assert.match(source, /#loadPreset, #loadPreviousMatch/);
  assert.match(source, /allowExplicitLegacyImport\(\)/);
  assert.match(source, /window\.addEventListener\('tbg:team-submission-saved'/);
  assert.match(source, /managerEdited=false/);
});

test('tablet swaps explicitly authorise hidden-team import before synthetic change', async () => {
  const source = await read('public/formation-board-touch-fix.js');

  const authorise = source.indexOf("authoriseBoardImport(source)");
  const syntheticChange = source.indexOf("dispatchEvent(new Event('change', { bubbles: true }))");
  assert.ok(authorise >= 0 && syntheticChange > authorise, 'tablet bridge must authorise board import before synthetic change');
  assert.match(source, /importHiddenTeamIntoBoard\('tablet_swap_bridge'\)/);
  assert.match(source, /new CustomEvent\('tbg:team-sheet-override'/);
});

test('captain and tactics changes latch manager-owned state before portal refreshes', async () => {
  const source = await read('public/formation-board-touch-fix.js');

  assert.match(source, /if \(!event\.isTrusted\) return/);
  assert.match(source, /#captain, #mentality, #pressing, #tempo, #width, #defensiveLine/);
  assert.match(source, /importHiddenTeamIntoBoard\('captain_or_tactics_change'\)/);
});