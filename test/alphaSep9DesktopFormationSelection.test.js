import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../public/formation-board-touch-fix.js', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../public/formation-board.js', import.meta.url), 'utf8');

test('formation selection bridge captures tray player before later enhancement handlers', () => {
  assert.match(bridge, /let pendingPlayerId = null;/);
  assert.match(bridge, /document\.addEventListener\('click', handleFormationClick, true\)/);
  assert.match(bridge, /function currentBoardForTarget/);
  assert.match(bridge, /closest\('\.tray-player\[data-player-id\]'\)[\s\S]*pendingPlayerId = id\(trayPlayer\.dataset\.playerId\)/);
  assert.match(bridge, /closest\('\[data-zone\]\[data-index\]'\)[\s\S]*!pendingPlayerId/);
  assert.match(bridge, /applySwap\(board, pendingPlayerId, targetSlot\)/);
  assert.doesNotMatch(bridge, /selectedTrayPlayer/);
  assert.doesNotMatch(bridge, /touchSwapEnabled/);
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
