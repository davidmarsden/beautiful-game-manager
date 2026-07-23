import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/world-controls.js', import.meta.url), 'utf8');

test('canonical-world initializer uses the authenticated shared-world admin identity', () => {
  assert.match(source, /const isAdmin = Boolean\(sharedState\?\.is_admin \?\? bootstrap\?\.manager\?\.is_admin\)/);
  assert.match(source, /worldInitializer'\)\.hidden = hasWorld \|\| !isAdmin/);
});
