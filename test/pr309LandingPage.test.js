import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authCss = fs.readFileSync(new URL('../public/auth-fix.css', import.meta.url), 'utf8');
const authEntry = fs.readFileSync(new URL('../public/auth-entry.js', import.meta.url), 'utf8');

test('unauthenticated gate uses the Brazil palette from first paint', () => {
  assert.ok(authCss.includes('#authGate.auth-gate'));
  assert.ok(authCss.includes('#9fc785!important'));
  assert.ok(authCss.includes('background:#193375!important'));
  assert.ok(authCss.includes('border-color:#FFDC02!important'));
});

test('landing page explains TBG before manager sign in', () => {
  assert.ok(authEntry.includes('One world. Real players. Human managers.'));
  assert.ok(authEntry.includes('persistent online football management world'));
  assert.ok(authEntry.includes('Currently in controlled alpha.'));
  assert.ok(authEntry.includes("signin.append(card)"));
});

test('landing page preserves the existing login form and responsive layout', () => {
  assert.ok(authEntry.includes("document.getElementById('authGate')"));
  assert.ok(authEntry.includes("gate?.querySelector('.auth-card')"));
  assert.ok(authCss.includes('@media(max-width:820px)'));
  assert.ok(authCss.includes('.tbg-landing{'));
});
