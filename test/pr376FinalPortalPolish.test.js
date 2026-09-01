import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('final portal polish loads after the Brazil pitch shell', async () => {
  const loader = await read('public/portal-brazil-pitch.js');
  const pitch = loader.indexOf('./portal-brazil-pitch.css');
  const polish = loader.indexOf('./portal-final-polish.css');
  assert.ok(pitch >= 0);
  assert.ok(polish > pitch);
});

test('final polish fixes the feedback action and keeps the masthead visually continuous', async () => {
  const css = await read('public/portal-final-polish.css');
  assert.match(css, /\.alpha-feedback-button/);
  assert.match(css, /background:#2d6fa3!important/);
  assert.match(css, /border:1px solid #ffdc02!important/);
  assert.match(css, /#portal \.club-nav[\s\S]*background:#a8ca83!important/);
  assert.match(css, /#portal \.club-strip[\s\S]*background:#a8ca83!important/);
  assert.match(css, /#portal \.tabs[\s\S]*background:#173f50!important/);
  assert.match(css, /#portal \.tabs button\.active[\s\S]*background:#ffdc02!important/);
});

test('next fixture moves into the club masthead and the supporting strip becomes light three-up', async () => {
  const [loader, css] = await Promise.all([
    read('public/portal-brazil-pitch.js'),
    read('public/portal-final-polish.css')
  ]);

  assert.match(loader, /function compactFixtureMasthead\(\)/);
  assert.match(loader, /\.club-strip \.next-fixture/);
  assert.match(loader, /\.dashboard-grid \.panel:nth-child\(3\)/);
  assert.match(loader, /masthead-team-action/);
  assert.match(loader, /fixture-panel-retired/);
  assert.match(loader, /fixture-summary-three-up/);

  assert.match(css, /#portal \.club-strip[\s\S]*grid-template-columns:64px minmax\(250px,\.95fr\) minmax\(430px,1\.05fr\)!important/);
  assert.match(css, /#portal \.club-strip \.next-fixture[\s\S]*grid-template-areas:/);
  assert.match(css, /#portal \.dashboard-grid[\s\S]*grid-template-columns:1fr 1\.35fr 1fr!important/);
  assert.match(css, /#portal \.dashboard-grid[\s\S]*background:#dce5d8!important/);
  assert.match(css, /#portal \.dashboard-grid>\.panel[\s\S]*background:#e7ece4!important/);
  assert.match(css, /fixture-summary-three-up>\.panel:nth-child\(3\)[\s\S]*display:none!important/);
});

test('dashboard summary removes duplicate information and normalises divisions to D1 style', async () => {
  const loader = await read('public/portal-brazil-pitch.js');
  assert.match(loader, /function divisionLabel\(value\)/);
  assert.match(loader, /return match \? `D\$\{match\[1\]\}`/);
  assert.match(loader, /function simplifyDashboard\(data\)/);
  assert.match(loader, /clubMeta\.textContent = division/);
  assert.match(loader, /overview\.hidden = true/);
  assert.match(loader, /legacyLayout\.hidden = true/);
  assert.match(loader, /heading\.textContent = 'League'/);
  assert.match(loader, /detail\.textContent = points === '—' \? 'Points unavailable' : `\$\{points\} pts`/);
  assert.match(loader, /heading\.textContent = 'Squad'/);
  assert.match(loader, /<dt>Registered<\/dt><dd>\$\{registered\}<\/dd><dt>Owned<\/dt><dd>\$\{owned\}<\/dd>/);
  assert.doesNotMatch(loader, /World rank/);
});

test('club masthead uses curated club colours without replacing the Brazil shell', async () => {
  const [loader, css] = await Promise.all([
    read('public/portal-brazil-pitch.js'),
    read('public/portal-final-polish.css')
  ]);

  assert.match(loader, /const CLUB_COLOURS = new Map/);
  for (const club of ['real madrid','chelsea fc','manchester united','fc barcelona','juventus fc','fenerbahce']) {
    assert.match(loader, new RegExp(club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(loader, /function applyClubIdentity\(\)/);
  assert.match(loader, /--club-primary/);
  assert.match(loader, /--club-secondary/);
  assert.match(loader, /--club-accent/);
  assert.match(css, /\.club-strip\.club-colours-active::before/);
  assert.match(css, /linear-gradient\(90deg,var\(--club-primary\)/);
  assert.match(css, /\.club-strip\.club-colours-active \.crest[\s\S]*background:var\(--club-primary\)!important/);
});

test('portal canvas is wider on desktop and tablet while phones stay full width', async () => {
  const css = await read('public/portal-final-polish.css');
  assert.match(css, /--tbg-canvas:1060px/);
  assert.match(css, /@media\(max-width:1100px\) and \(min-width:701px\)[\s\S]*#portal \.shell\{width:90vw!important;max-width:1060px!important\}/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*#portal \.shell\{width:100%!important;max-width:none!important\}/);
});

test('News returns to lighter readable Brazil work surfaces', async () => {
  const css = await read('public/portal-final-polish.css');
  assert.match(css, /#portal #feedView[\s\S]*background:#9fc785!important/);
  assert.match(css, /#portal #feedView \.world-feed-item[\s\S]*background:#e7ece4!important/);
  assert.match(css, /world-feed-item:nth-child\(3n\+2\)[\s\S]*background:#dce5d8!important/);
  assert.match(css, /world-feed-item:nth-child\(3n\)[\s\S]*background:#d4e0e5!important/);
  assert.doesNotMatch(css.toLowerCase(), /#f8dfe8|#f5cfdd|#fcebf1|#f8dce7|#f6d5e2|#f9e3eb|#f2b9ce|#d986a8|#bd6488/);
});
