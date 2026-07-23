import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const functionSource = await readFile(new URL('../netlify/functions/request-login-link.mjs', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../public/login-proxy.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('magic-link request is proxied through the same-origin Netlify endpoint', () => {
  assert.match(bridgeSource, /fetch\('\/api\/request-login-link'/);
  assert.match(bridgeSource, /stopImmediatePropagation\(\)/);
  assert.match(html, /src="\.\/login-proxy\.js"/);
});

test('server proxy normalizes configuration and sends the public key to Supabase Auth', () => {
  assert.match(functionSource, /String\(value \|\| ''\)\.trim\(\)/);
  assert.match(functionSource, /replace\(\/\\\/\+\$\/, ''\)/);
  assert.match(functionSource, /new URL\('\/auth\/v1\/otp'/);
  assert.match(functionSource, /apikey:\s*SUPABASE_ANON_KEY/);
  assert.doesNotMatch(functionSource, /authorization:\s*`Bearer \$\{SUPABASE_ANON_KEY\}`/);
  assert.match(functionSource, /requested\.origin !== origin/);
});

test('server proxy returns useful transport diagnostics without exposing secrets', () => {
  assert.match(functionSource, /error\?\.cause\?\.code/);
  assert.match(functionSource, /fetchFailure\(error\)/);
  assert.doesNotMatch(functionSource, /SERVICE_ROLE/);
  assert.doesNotMatch(functionSource, /sb_secret/);
});
