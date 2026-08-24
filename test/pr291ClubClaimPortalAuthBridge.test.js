import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const claim = read('public/club-claiming.js');
const bridge = read('public/portal-auth-bridge.js');

test('#291 club claiming reuses the already-proven portal authorization header', () => {
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(claim, /window\.tbgPortalAuthorization/);
  assert.match(claim, /startsWith\('bearer '\)/);
  assert.match(claim, /authorization:\s*auth/);
});

test('#291 club claiming retains Supabase session lookup as fallback and stale-token recovery', () => {
  assert.match(claim, /const bridged = String\(window\.tbgPortalAuthorization/);
  assert.match(claim, /const current = await session\(\)/);
  assert.match(claim, /current\?\.access_token/);
  assert.match(claim, /response\.status === 401/);
  assert.match(claim, /freshAuthorization\(\)/);
  assert.match(claim, /response = await request\(refreshedAuth\)/);
  assert.match(claim, /window\.tbgPortalAuthorization = auth/);
});
