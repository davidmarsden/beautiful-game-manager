import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

const authOwner = read('app.js');
const secondaryPortalClients = [
  'auth-entry.js',
  'phase2c2b.js',
  'functional-inbox.js',
  'team-presets.js',
  'club-claiming.js',
  'alpha-feedback.js'
].map((name) => [name, read(name)]);

test('manager portal has exactly one auto-refreshing Supabase auth owner', () => {
  assert.match(authOwner, /autoRefreshToken:\s*true/);
  for (const [name, source] of secondaryPortalClients) {
    assert.doesNotMatch(source, /autoRefreshToken:\s*true/, `${name} must not compete with app.js for refresh-token ownership`);
  }
});

test('secondary portal Supabase clients retain persisted-session fallback without auto refresh', () => {
  for (const [name, source] of secondaryPortalClients) {
    assert.match(source, /persistSession:\s*true/, `${name} should still read the shared persisted session`);
    assert.match(source, /autoRefreshToken:\s*false/, `${name} should leave token rotation to app.js`);
  }
});
