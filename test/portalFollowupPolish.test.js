import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('news adds transfer-style category tabs and tablet-friendly reading columns', async () => {
  const [behaviour, css, managerDirectory] = await Promise.all([
    read('public/portal-followup.js'),
    read('public/portal-followup.css'),
    read('public/manager-directory.js')
  ]);

  assert.match(managerDirectory, /import '\.\/portal-followup\.js'/);
  assert.match(behaviour, /\['all', 'All news'\]/);
  assert.match(behaviour, /\['matchdays', 'Matchdays'\]/);
  assert.match(behaviour, /\['transfers', 'Transfers'\]/);
  assert.match(behaviour, /\['managers', 'Managers'\]/);
  assert.match(behaviour, /\['community', 'Community'\]/);
  assert.match(behaviour, /world-feed-matchday_press_conference/);
  assert.match(behaviour, /MutationObserver/);
  assert.match(css, /#feedView \.world-feed-category-tabs/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:980px\)/);
});

test('inbox overview, updates and player links use the shared blue yellow cream hierarchy', async () => {
  const css = await read('public/portal-followup.css');

  assert.match(css, /#dashboardView #portalOverview>article/);
  assert.match(css, /var\(--tbg-colour-cream,#f8f7e8\)/);
  assert.match(css, /var\(--tbg-brazil-blue,#193375\)/);
  assert.match(css, /var\(--tbg-brazil-yellow,#FFDC02\)/);
  assert.match(css, /#squadView \.player-link/);
  assert.match(css, /#updatesView \.player-updates-hero/);
  assert.match(css, /#updatesView \.player-update-card/);
});

test('manager directory resolves canonical club names instead of exposing club ids when available', async () => {
  const fn = await read('netlify/functions/manager-participation.mjs');

  assert.match(fn, /get_manager_transfer_directory_for_user/);
  assert.match(fn, /clubNamesForWorld\(userId, worldId\)/);
  assert.match(fn, /club_name: clubNames\.get\(String\(row\.club_id\)\) \|\| row\.club_id/);
  assert.match(fn, /managerDirectory\(context\.worldId, context\.managerId, user\.id\)/);
});
