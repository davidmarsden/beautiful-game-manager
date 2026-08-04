import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const functions = fs.readdirSync(new URL('../netlify/functions/', import.meta.url));

test('production turn worker uses the Netlify background-function suffix', () => {
  assert.ok(functions.includes('scheduled-world-turn-background.mjs'));
});
