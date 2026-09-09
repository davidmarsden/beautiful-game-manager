import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const touchFix = fs.readFileSync(new URL('../public/formation-board-touch-fix.js', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../public/formation-board.js', import.meta.url), 'utf8');

test('tablet swap bridge is restricted to coarse-pointer devices', () => {
  assert.match(touchFix, /matchMedia\?\.\('\(hover: none\) and \(pointer: coarse\)'\)/);
  assert.match(touchFix, /function install\(\)[\s\S]*if \(!touchSwapEnabled\) return false;/);
  assert.match(touchFix, /window\.addEventListener\('load',[\s\S]*if \(!touchSwapEnabled\) return;/);
});

test('desktop formation board retains its native click and drag placement path', () => {
  assert.match(board, /board\.addEventListener\('click',[\s\S]*clickSlot/);
  assert.match(board, /board\.addEventListener\('dragstart'/);
  assert.match(board, /board\.addEventListener\('drop',[\s\S]*placePlayer/);
});
