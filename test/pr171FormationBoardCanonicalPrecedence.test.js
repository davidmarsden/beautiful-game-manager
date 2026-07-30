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
  assert.match(source, /if \(event\.isTrusted \|\| allowLegacyImport\) refreshFromPersistedInputs\(\)/);
  assert.match(source, /document\.addEventListener\('tbg:team-sheet-override', allowExplicitLegacyImport\)/);
  assert.match(source, /document\.addEventListener\('change', \(event\) => \{[\s\S]*if \(!event\.target\?\.matches\('input\[data-zone="xi"\], input\[data-zone="bench"\]'\)\) return;[\s\S]*if \(event\.isTrusted \|\| allowLegacyImport\) refreshFromPersistedInputs\(\);[\s\S]*\}\);/);
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
