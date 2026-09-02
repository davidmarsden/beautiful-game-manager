import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

const authOwner = read('app.js');
const bridge = read('portal-auth-bridge.js');
const secondaryPortalClients = [
  'auth-entry.js',
  'login-proxy.js',
  'password-account.js',
  'phase2c2b.js',
  'functional-inbox.js',
  'team-presets.js',
  'club-claiming.js',
  'alpha-feedback.js'
].map((name) => [name, read(name)]);
const sharedBearerModules = [
  'phase2c2b.js',
  'functional-inbox.js',
  'team-presets.js'
].map((name) => [name, read(name)]);
const persistedFallbackClients = [
  'auth-entry.js',
  'login-proxy.js',
  'password-account.js',
  'club-claiming.js',
  'alpha-feedback.js'
].map((name) => [name, read(name)]);

test('manager portal has exactly one auto-refreshing Supabase auth owner', () => {
  assert.match(authOwner, /autoRefreshToken:\s*true/);
  for (const [name, source] of secondaryPortalClients) {
    assert.doesNotMatch(source, /autoRefreshToken:\s*true/, `${name} must not compete with app.js for refresh-token ownership`);
  }
});

test('startup feature modules consume only the shared portal bearer', () => {
  assert.match(bridge, /window\.tbgPortalAuth\s*=\s*Object\.freeze/);
  assert.match(bridge, /waitForAuthorization/);
  assert.match(bridge, /payload\?\.access_token/);
  for (const [name, source] of sharedBearerModules) {
    assert.match(source, /tbgPortalAuth\?\.waitForAuthorization/, `${name} should wait for the owner bearer`);
    assert.doesNotMatch(source, /createClient/, `${name} must not create a Supabase auth client`);
    assert.doesNotMatch(source, /\.auth\.getSession\s*\(/, `${name} must not inspect or refresh the persisted session`);
    assert.doesNotMatch(source, /\/api\/auth-config/, `${name} must not bootstrap a secondary Supabase client`);
  }
});

test('remaining fallback clients persist the session without owning refresh', () => {
  for (const [name, source] of persistedFallbackClients) {
    assert.match(source, /persistSession:\s*true/, `${name} should still read the shared persisted session`);
    assert.match(source, /autoRefreshToken:\s*false/, `${name} should leave token rotation to app.js`);
  }
});
