import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/portal-state-cache.js', import.meta.url), 'utf8');

test('player signings invalidate the cached manager bootstrap snapshot', () => {
  assert.match(source, /['"]\/api\/free-agents['"]/);
  assert.match(source, /method !== ['"]GET['"]/);
  assert.match(source, /if \(invalidatesBootstrap\(input, init\)\) invalidateBootstrapCache\(\)/);
});
