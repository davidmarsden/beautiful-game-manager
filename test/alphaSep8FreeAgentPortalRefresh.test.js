import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/portal-state-cache.js', import.meta.url), 'utf8');

test('player signings invalidate the cached manager bootstrap snapshot before and after the write', () => {
  assert.match(source, /['"]\/api\/free-agents['"]/);
  assert.match(source, /method !== ['"]GET['"]/);
  assert.match(source, /const invalidatingWrite = invalidatesBootstrap\(input, init\)/);
  assert.match(source, /if \(invalidatingWrite\) \{[\s\S]*invalidateBootstrapCache\(\);[\s\S]*try \{[\s\S]*return await networkFetch\(input, init\);[\s\S]*\} finally \{[\s\S]*invalidateBootstrapCache\(\);[\s\S]*\}/);
});
