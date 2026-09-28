import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const accountSource = await readFile(new URL('../public/password-account.js', import.meta.url), 'utf8');

test('login screen offers password sign-in without removing magic-link access', () => {
  assert.match(indexSource, /id="loginPassword"/);
  assert.match(indexSource, /id="magicLinkButton"/);
  assert.match(appSource, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(appSource, /\/api\/request-login-link/);
  assert.doesNotMatch(indexSource, /login-proxy\.js/);
});

test('signed-in managers can set a password on their existing Supabase user', () => {
  assert.match(indexSource, /id="passwordButton"/);
  assert.match(indexSource, /id="passwordDialog"/);
  assert.match(accountSource, /auth\.getSession\(\)/);
  assert.match(accountSource, /auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(accountSource, /signUp\(/);
});

test('primary portal auth owns exactly one login form submit path', () => {
  const handlers = appSource.match(/\$\("loginForm"\)\.addEventListener\("submit"/g) || [];
  assert.equal(handlers.length, 1);
  assert.match(appSource, /\$\("magicLinkButton"\)\?\.addEventListener\("click"/);
});
