import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Transfers outer workspace overrides generic white world-control-card styling', async () => {
  const css = await read('public/transfer-negotiations.css');
  assert.match(css, /\.world-control-card\.transfer-negotiation-workspace\s*\{[^}]*background:\s*var\(--tbg-colour-workspace-raised/);
});
