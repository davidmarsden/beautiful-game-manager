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

test('server proxy sends the public key to Supabase Auth and preserves portal redirect', () => {
  assert.match(functionSource, /\/auth\/v1\/otp\?redirect_to=/);
  assert.match(functionSource, /apikey:\s*SUPABASE_ANON_KEY/);
  assert.match(functionSource, /authorization:\s*`Bearer \$\{SUPABASE_ANON_KEY\}`/);
  assert.match(functionSource, /requested\.origin !== origin/);
});

test('server proxy does not expose or require the service-role key', () => {
  assert.doesNotMatch(functionSource, /SERVICE_ROLE/);
  assert.doesNotMatch(functionSource, /sb_secret/);
});
