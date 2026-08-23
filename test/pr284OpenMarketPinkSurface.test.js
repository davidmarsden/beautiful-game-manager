import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Open market uses Football Pink surfaces instead of its runtime white fallback', async () => {
  const css = await read('public/football-pink-stock.css');
  assert.match(css, /#transfersView \.open-market-shell\s*\{[^}]*background:\s*var\(--tbg-surface-card/);
  assert.match(css, /#transfersView \.open-market-card,[\s\S]*background:\s*var\(--tbg-colour-workspace-raised/);
});
