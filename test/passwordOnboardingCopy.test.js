import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('password onboarding makes the email-link and password steps explicit', async () => {
  const js = await read('public/password-account.js');
  assert.match(js, /That does not create a password/);
  assert.match(js, /choose <strong>Password<\/strong> at the top/);
  assert.match(js, /Saving it is what enables email \+ password sign-in/);
  assert.match(js, /Password saved\. You can now sign in directly with your email and this password\./);
});

test('first-sign-in profile copy points new managers to the password step', async () => {
  const js = await read('public/password-account.js');
  assert.match(js, /Complete your manager profile, then choose Password at the top of the portal/);
});
