import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../netlify/functions/initialize-canonical-world.mjs', import.meta.url), 'utf8');

test('user requests use anon apikey with the signed-in user bearer token', () => {
  assert.match(source, /apiKey:\s*SUPABASE_ANON_KEY,\s*bearer:\s*token/);
  assert.doesNotMatch(source, /requestSupabase\([^\n]+,\s*token\)/);
});

test('new Supabase secret keys are never sent as bearer JWTs', () => {
  assert.match(source, /isJwt\(SUPABASE_SERVICE_ROLE_KEY\)/);
  assert.match(source, /apiKey:\s*SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /\? \{ bearer: SUPABASE_SERVICE_ROLE_KEY \} : \{\}/);
});

test('legacy service-role JWTs remain supported', () => {
  assert.match(source, /String\(value \|\| ''\)\.split\('\.'\)\.length === 3/);
});
