import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../public/formation-board-touch-fix.js', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../public/formation-board.js', import.meta.url), 'utf8');

test('formation selection bridge captures interactions before later enhancement handlers', () => {
  assert.match(bridge, /let pendingPlayerId = null;/);
  assert.match(bridge, /document\.addEventListener\('pointerdown', handleFormationPointer, true\)/);
  assert.match(bridge, /document\.addEventListener\('click', handleFormationClick, true\)/);
  assert.match(bridge, /function currentBoardForInteraction/);
  assert.match(bridge, /function trayPlayerForInteraction/);
  assert.match(bridge, /function slotForInteraction/);
  assert.match(bridge, /pendingPlayerId = id\(player\.dataset\.playerId\)/);
  assert.match(bridge, /applySwap\(board, pendingPlayerId, targetSlot\)/);
  assert.doesNotMatch(bridge, /selectedTrayPlayer/);
  assert.doesNotMatch(bridge, /touchSwapEnabled/);
});

test('Edge fallback hit-tests player cards and slots by pointer coordinates', () => {
  assert.match(bridge, /function containsPoint\(element, x, y\)/);
  assert.match(bridge, /function elementAtPoint\(elements, x, y\)/);
  assert.match(bridge, /elementAtPoint\(qa\('#formationSquadTray \.tray-player\[data-player-id\]'/);
  assert.match(bridge, /elementAtPoint\(qa\('#formationPitch \[data-zone\]\[data-index\], #formationBench \[data-zone\]\[data-index\]'/);
  assert.match(bridge, /return containsPoint\(board, event\.clientX, event\.clientY\) \? board : null;/);
});

test('bridged placement preserves sparse formation slot indexes', () => {
  assert.match(bridge, /new CustomEvent\('tbg:formation-place-player'/);
  assert.match(bridge, /zone: targetSlot\.dataset\.zone/);
  assert.match(bridge, /index: Number\(targetSlot\.dataset\.index\)/);
  assert.match(board, /document\.addEventListener\('tbg:formation-place-player'/);
  assert.match(board, /placePlayer\(norm\(detail\.player_id\), zone, index\)/);
  assert.match(board, /syncLegacyInputs\(\)/);
  const applySwapBody = bridge.match(/function applySwap\([\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(applySwapBody, /orderedChecked\(/);
  assert.doesNotMatch(applySwapBody, /importHiddenTeamIntoBoard\(/);
});

test('placePlayer writes into the live assignment array after removePlayer refreshes it', () => {
  const placePlayerBody = board.match(/function placePlayer\([\s\S]*?\n}\nfunction clickSlot/)[0];
  const removeIndex = placePlayerBody.indexOf('removePlayer(id);');
  const reacquireIndex = placePlayerBody.indexOf("const currentTarget = zone === 'xi' ? assignments : benchAssignments;");
  const writeIndex = placePlayerBody.indexOf('currentTarget[index] = id;');
  assert.ok(removeIndex >= 0 && reacquireIndex > removeIndex && writeIndex > reacquireIndex);
  assert.doesNotMatch(placePlayerBody, /removePlayer\(id\);\n  target\[index\] = id;/);
});

test('temporary selection diagnostics are removed from production bridge', () => {
  assert.doesNotMatch(bridge, /Selection diagnostic/);
  assert.doesNotMatch(bridge, /diagnosticHost/);
  assert.doesNotMatch(bridge, /setDiagnostic/);
});

test('desktop formation board retains its native click and drag placement path as fallback', () => {
  assert.match(board, /board\.addEventListener\('click',[\s\S]*clickSlot/);
  assert.match(board, /board\.addEventListener\('dragstart'/);
  assert.match(board, /board\.addEventListener\('drop',[\s\S]*placePlayer/);
});
