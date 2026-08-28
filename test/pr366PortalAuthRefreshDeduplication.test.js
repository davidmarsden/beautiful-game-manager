import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../public/portal-auth-bridge.js', import.meta.url), 'utf8');

test('portal auth bridge deduplicates concurrent refresh-token requests', () => {
  assert.match(bridge, /const authRefreshes = new Map\(\)/);
  assert.match(bridge, /grant_type.*refresh_token/);
  assert.match(bridge, /coordinatedAuthRefresh/);
  assert.match(bridge, /authRefreshes\.get\(key\)/);
  assert.match(bridge, /response\.clone\(\)/);
});
