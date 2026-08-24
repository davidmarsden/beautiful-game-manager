import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/club-claiming.js', import.meta.url), 'utf8');

test('#291 club claiming does not cache a null auth session', () => {
  assert.doesNotMatch(source, /sessionPromise/);
  assert.match(source, /supabase\.auth\.getSession\(\)/);
  assert.match(source, /for \(let attempt = 0; attempt < 4; attempt \+= 1\)/);
});

test('#291 club claiming uses the same PKCE auth mode as the manager portal', () => {
  assert.match(source, /flowType:\s*['\"]pkce['\"]/);
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /autoRefreshToken:\s*true/);
});
