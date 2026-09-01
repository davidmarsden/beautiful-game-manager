import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard dedup stays presentation-only', async () => {
  const [loader, css, portal] = await Promise.all([
    read('public/portal-brazil-pitch.js'),
    read('public/portal-dashboard-dedup.css'),
    read('public/portal-v1.js')
  ]);

  assert.match(loader, /\.\/portal-dashboard-dedup\.css/);
  assert.match(css, /#portal #dashboardView > #portalOverview/);
  assert.match(css, /#portal #dashboardView > \.portal-layout/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(portal, /function renderSummary\(model\)/, 'portal-v1 renderer must remain untouched by this pass');
});
