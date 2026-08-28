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

test('refresh dedupe compares Request-object bodies and safely handles incomparable bodies', () => {
  assert.match(bridge, /input instanceof Request/);
  assert.match(bridge, /input\.clone\(\)\.text\(\)/);
  assert.match(bridge, /bodyComparable/);
  assert.match(bridge, /if \(!details\.bodyComparable\) \{[\s\S]*?upstreamFetch\(\.\.\.args\)[\s\S]*?publishRefreshAuthorization\(response\)[\s\S]*?return response;[\s\S]*?\}/);
  assert.match(bridge, /const key = `\$\{details\.url\.origin\}\|\$\{String\(details\.body\)\}`/);
});

test('refresh requests do not publish their request Authorization header', () => {
  const refreshCheck = bridge.indexOf('const authRefreshRequest = Boolean(');
  const refreshReturn = bridge.indexOf('if (authRefreshRequest) return coordinatedAuthRefresh(args, details);');
  const publishRequestAuth = bridge.indexOf('if (details.authorization) publishAuthorization(details.authorization);');
  assert.ok(refreshCheck >= 0 && refreshReturn > refreshCheck && publishRequestAuth > refreshReturn);
});
