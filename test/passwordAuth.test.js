import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../public/login-controls.js', import.meta.url), 'utf8');
const accountSource = await readFile(new URL('../public/password-account.js', import.meta.url), 'utf8');

test('login screen offers password sign-in without removing magic-link access', () => {
  assert.match(indexSource, /id="loginPassword"/);
  assert.match(indexSource, /id="magicLinkButton"/);
  assert.match(indexSource, /src="\.\/login-controls\.js"/);
  assert.match(loginSource, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(loginSource, /\/api\/request-login-link/);
  assert.doesNotMatch(indexSource, /login-proxy\.js/);
});

test('signed-in managers can set a password on their existing Supabase user', () => {
  assert.match(indexSource, /id="passwordButton"/);
  assert.match(indexSource, /id="passwordDialog"/);
  assert.match(accountSource, /auth\.getSession\(\)/);
  assert.match(accountSource, /auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(accountSource, /signUp\(/);
});

test('independent login controls own exactly one login form submit path without owning token refresh', () => {
  const handlers = loginSource.match(/\$\("loginForm"\)\?\.addEventListener\("submit"/g) || [];
  assert.equal(handlers.length, 1);
  assert.match(loginSource, /\$\("magicLinkButton"\)\?\.addEventListener\("click"/);
  assert.match(loginSource, /persistSession:\s*true/);
  assert.match(loginSource, /autoRefreshToken:\s*false/);\n  assert.match(loginSource, /AUTH_TIMEOUT_MS\s*=\s*12000/);\n  assert.match(loginSource, /Connecting to TBG…/);\n  assert.match(loginSource, /Checking credentials…/);\n  assert.match(loginSource, /Supabase password sign-in/);
});
