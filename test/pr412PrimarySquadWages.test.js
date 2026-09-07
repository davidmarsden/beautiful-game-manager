import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/squad-player-statistics.js', import.meta.url), 'utf8');

test('signed-in General and Contracts squad views expose sortable weekly wages', () => {
  assert.match(source, /general:\s*\{[\s\S]*\['Wage', 'wage'\]/);
  assert.match(source, /contracts:\s*\{[\s\S]*\['Wage', 'wage'\]/);
  assert.match(source, /function wageValue\(player\)/);
  assert.match(source, /£\$\{Math\.round\(wage\)\.toLocaleString\('en-GB'\)\}\/wk/);
  assert.match(source, /if \(key === 'wage'\) return wageValue\(player\)/);
  assert.match(source, /function generalCells\(player\)/);
  assert.match(source, /function contractCells\(player\)/);
  assert.match(source, /const columnCount = VIEWS\[viewName\]\.headers\.length/);
});
