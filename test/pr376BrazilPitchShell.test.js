import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('final Brazil pitch layer is loaded after the portal feature modules', async () => {
  const [profileLinks, loader] = await Promise.all([
    read('public/internal-profile-links.js'),
    read('public/portal-brazil-pitch.js')
  ]);

  assert.match(profileLinks, /import '\.\/portal-brazil-pitch\.js';/);
  assert.match(loader, /portal-brazil-pitch\.css/);
  assert.match(loader, /document\.head\.append\(link\)/);
  assert.match(loader, /tbg:portal-rendered/);
  assert.match(loader, /tbg:view-changed/);
});

test('Brazil pitch shell uses a dark patterned football frame around a lighter game canvas', async () => {
  const css = await read('public/portal-brazil-pitch.css');

  assert.match(css, /--tbg-pitch-deep:#071f13/);
  assert.match(css, /--tbg-canvas-green:#9fc785/);
  assert.match(css, /repeating-linear-gradient\(90deg/);
  assert.match(css, /radial-gradient\(circle at 50% 50%/);
  assert.match(css, /background-attachment:fixed!important/);
  assert.match(css, /#portal \.shell\{[\s\S]*background:linear-gradient\(180deg,var\(--tbg-canvas-green\)/);
});

test('Brazil pitch shell harmonises every primary portal view', async () => {
  const css = await read('public/portal-brazil-pitch.css');

  for (const view of ['dashboardView','feedView','squadView','tacticsView','scheduleView','competitionsView','transfersView','updatesView','financeView','historyView','managersView','worldView']) {
    assert.match(css, new RegExp(`#portal #${view.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }

  assert.match(css, /--tbg-brazil-navy:#102330/);
  assert.match(css, /--tbg-brazil-blue:#193375/);
  assert.match(css, /--tbg-brazil-sky:#2d6fa3/);
  assert.match(css, /--tbg-brazil-yellow:#ffdc02/);
});

test('light and dark portal surfaces explicitly own their foreground contrast', async () => {
  const css = await read('public/portal-brazil-pitch.css');

  assert.match(css, /#portal \.view\{[\s\S]*color:var\(--tbg-ink\)!important/);
  assert.match(css, /#portal #dashboardView \.inbox-message\{background:#e7ece4!important;color:#17212a!important/);
  assert.match(css, /#portal #feedView \.world-feed-item\{background:#173e56!important;color:#f4f7f4!important/);
  assert.match(css, /#portal #transfersView \.open-market-shell[\s\S]*background:#e1e9de!important;color:#17212a!important/);
  assert.match(css, /#portal #tacticsView \.pitch-panel[\s\S]*background:#164b32!important;color:#f4f7f4!important/);
});

test('final Brazil pitch shell does not reintroduce Football Pink palette values', async () => {
  const css = (await read('public/portal-brazil-pitch.css')).toLowerCase();
  const retiredPink = ['#f8dfe8','#f5cfdd','#fcebf1','#f8dce7','#f6d5e2','#f9e3eb','#f2b9ce','#d986a8','#bd6488'];
  for (const colour of retiredPink) assert.equal(css.includes(colour), false, `${colour} must stay retired`);
});
