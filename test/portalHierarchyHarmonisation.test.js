import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Managers is a first-class portal view rather than a nav-triggered modal', async () => {
  const [navigation, directory] = await Promise.all([
    read('public/portal-navigation.js'),
    read('public/manager-directory.js')
  ]);

  assert.match(navigation, /\['managers', 'managers'\]/);
  assert.match(navigation, /dataset\.view = 'managers'/);
  assert.match(navigation, /id = 'managersView'/);
  assert.doesNotMatch(navigation, /dataset\.portalAction = 'managers'/);
  assert.match(directory, /manager-directory-list-row/);
  assert.match(directory, /data-manager-profile-id/);
  assert.match(directory, /openManagerParticipation\(''\)/);
});

test('Managers directory includes the signed-in manager in the appointed total', async () => {
  const directory = await read('public/manager-directory.js');

  assert.match(directory, /const hasSelf = Boolean\(data\.manager_name \|\| data\.club_name\)/);
  assert.match(directory, /data-manager-directory-self/);
  assert.match(directory, /const appointedCount = directory\.length \+ \(hasSelf \? 1 : 0\)/);
  assert.match(directory, /<strong>\$\{appointedCount\}<\/strong><span>appointed managers<\/span>/);
});

test('shared hierarchy stylesheet is loaded after dynamic page styles', async () => {
  const navigation = await read('public/portal-navigation.js');
  const hierarchy = await read('public/portal-hierarchy.css');

  assert.match(navigation, /installStylesheet\('\.\/portal-hierarchy\.css'\)/);
  assert.match(hierarchy, /#dashboardView \.inbox-message/);
  assert.match(hierarchy, /#feedView \.world-feed-item/);
  assert.match(hierarchy, /#squadView \.table-wrap/);
  assert.match(hierarchy, /#financeView \.finance-shell/);
  assert.match(hierarchy, /\.manager-directory-shell/);
});

test('portal hierarchy uses blue structure, yellow emphasis and neutral working surfaces', async () => {
  const css = await read('public/portal-hierarchy.css');

  assert.match(css, /var\(--tbg-brazil-blue,#193375\)/);
  assert.match(css, /var\(--tbg-brazil-yellow,#FFDC02\)/);
  assert.match(css, /var\(--tbg-colour-cream,#f8f7e8\)/);
  assert.match(css, /background:#fff!important/);
  assert.match(css, /manager-directory-list-row:nth-child\(even\)/);
});
