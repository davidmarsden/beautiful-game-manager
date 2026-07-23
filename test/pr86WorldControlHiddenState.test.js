import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shared-world hidden sections override grid display rules', async () => {
  const css = await readFile(new URL('../public/world-controls.css', import.meta.url), 'utf8');
  assert.match(css, /#worldView\s+\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/);
  assert.match(css, /\.world-control-grid\s*\{\s*display\s*:\s*grid/);
});
