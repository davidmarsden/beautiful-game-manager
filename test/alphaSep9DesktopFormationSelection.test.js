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
  assert.match(bridge, /captured \$\{pendingPlayerId\} via \$\{event\.type\} \(target \$\{targetDescription\(event\.target\)\}\)/);
});

test('selection diagnostics install independently of a player click', () => {
  assert.match(bridge, /host\.textContent = 'Selection diagnostic ready\.'/);
  assert.match(bridge, /function install\(\)[\s\S]*if \(board\) diagnosticHost\(board\)/);
  assert.match(bridge, /install\(\);\nwindow\.addEventListener\('load'/);
});

test('desktop formation board retains its native click and drag placement path as fallback', () => {
  assert.match(board, /board\.addEventListener\('click',[\s\S]*clickSlot/);
  assert.match(board, /board\.addEventListener\('dragstart'/);
  assert.match(board, /board\.addEventListener\('drop',[\s\S]*placePlayer/);
});
