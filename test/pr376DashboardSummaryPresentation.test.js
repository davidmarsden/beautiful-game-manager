import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard summary presentation changes values without replacing contract nodes', async () => {
  const [loader, css] = await Promise.all([
    read('public/portal-brazil-pitch.js'),
    read('public/portal-dashboard-dedup.css')
  ]);

  assert.match(loader, /function applyDashboardDisplay\(data\)/);
  assert.match(loader, /leagueHeading\.textContent = 'League'/);
  assert.match(loader, /squadHeading\.textContent = 'Squad'/);
  assert.match(loader, /clubMeta\.textContent = divisionLabel\(data\.club\.division_id\)/);
  assert.match(loader, /registered\.textContent = registeredSeniorCount\(squad\)/);
  assert.match(loader, /owned\.textContent = squad\.length/);
  assert.match(loader, /requestAnimationFrame\(\(\) => applyDashboardDisplay\(event\.detail\)\)/);
  assert.doesNotMatch(loader, /replaceChildren/);
  assert.doesNotMatch(loader, /squadList\.innerHTML/);

  assert.match(css, /dt:nth-of-type\(3\)/);
  assert.match(css, /dd:nth-of-type\(3\)/);
});

test('PR 376 dashboard presentation does not move into portal-v1 renderer', async () => {
  const renderer = await read('public/portal-v1.js');
  assert.doesNotMatch(renderer, /applyDashboardDisplay/);
  assert.doesNotMatch(renderer, /renderDashboardSummary/);
});
