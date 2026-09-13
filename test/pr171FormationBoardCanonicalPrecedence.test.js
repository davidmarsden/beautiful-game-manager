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

test('formation bridge places directly into the sparse board slot instead of compact hidden-team order', async () => {
  const bridge = await read('public/formation-board-touch-fix.js');
  const board = await read('public/formation-board.js');

  assert.match(bridge, /new CustomEvent\('tbg:formation-place-player'/);
  assert.match(bridge, /player_id: movingId/);
  assert.match(bridge, /zone: targetSlot\.dataset\.zone/);
  assert.match(bridge, /index: Number\(targetSlot\.dataset\.index\)/);
  assert.doesNotMatch(bridge, /importHiddenTeamIntoBoard\('formation_selection_bridge'\)/);
  assert.match(board, /document\.addEventListener\('tbg:formation-place-player'/);
  assert.match(board, /placePlayer\(norm\(detail\.player_id\), zone, index\)/);
  assert.match(board, /syncLegacyInputs\(\)/);
});

test('captain and tactics changes still explicitly authorise hidden-team import before synthetic change', async () => {
  const source = await read('public/formation-board-touch-fix.js');

  const authorise = source.indexOf('authoriseBoardImport(source)');
  const syntheticChange = source.indexOf("dispatchEvent(new Event('change', { bubbles: true }))");
  assert.ok(authorise >= 0 && syntheticChange > authorise, 'captain/tactics import must authorise board import before synthetic change');
  assert.match(source, /new CustomEvent\('tbg:team-sheet-override'/);
  assert.match(source, /if \(!event\.isTrusted\) return/);
  assert.match(source, /#captain, #mentality, #pressing, #tempo, #width, #defensiveLine/);
  assert.match(source, /importHiddenTeamIntoBoard\('captain_or_tactics_change'\)/);
});
