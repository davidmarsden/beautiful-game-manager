import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('1982 visual foundation loads after existing component styles', async () => {
  const html = await read('public/index.html');
  const foundation = html.indexOf('design-1982.css');
  const polish = html.indexOf('targeted-component-polish.css');
  assert.ok(foundation > polish, 'visual foundation must load after existing component styles so it can set the final art direction');
});

test('legacy runtime themes do not override the 1982 foundation after portal startup', async () => {
  const community = await read('public/community-card.js');
  const html = await read('public/index.html');
  assert.doesNotMatch(community, /tbg-green-stock\.css/);
  assert.doesNotMatch(community, /tbg-brazil-polish\.css/);
  assert.doesNotMatch(html, /football-pink-stock\.css/);
  assert.match(community, /community-card\.css/);
  assert.match(community, /manager-contact\.css/);
});

test('visual foundation defines shared Brazil-era palette and typography tokens', async () => {
  const css = await read('public/design-1982.css');
  for (const token of ['--tbg-paper','--tbg-surface','--tbg-ink','--tbg-navy','--tbg-accent','--tbg-rule','--tbg-display','--tbg-ui','--tbg-mono','--tbg-canvas']) {
    assert.match(css, new RegExp(token.replaceAll('-', '\\-')));
  }
  assert.match(css, /--tbg-paper:#dceccd/);
  assert.match(css, /--tbg-accent:#ffdc02/);
  assert.match(css, /--tbg-colour-paper:#9fc785/);
  assert.match(css, /repeating-linear-gradient\(90deg,#2c733d/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /select:focus-visible/);
});

test('visual foundation uses a strongly contained classic game canvas without sacrificing phone width', async () => {
  const css = await read('public/design-1982.css');
  assert.match(css, /--tbg-canvas:960px/);
  assert.match(css, /\.shell\{[\s\S]*width:min\(calc\(100% - 120px\),var\(--tbg-canvas\)\)/);
  assert.match(css, /@media\(max-width:1100px\)[\s\S]*\.shell\{width:82vw\}/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.shell\{width:100%;padding-inline:8px\}/);
  assert.match(css, /\.dashboard-grid\{[\s\S]*gap:0/);
  assert.match(css, /\.panel\{[\s\S]*min-height:82px/);
});

test('visual foundation removes generic rounded app chrome from core portal surfaces', async () => {
  const css = await read('public/design-1982.css');
  assert.match(css, /--tbg-radius:2px/);
  assert.match(css, /\.world-pill\{[\s\S]*border-radius:0/);
  assert.match(css, /\.tabs button\.active\{[\s\S]*var\(--tbg-accent\)/);
  assert.match(css, /\.dashboard-grid\{[\s\S]*border-top:3px solid var\(--tbg-navy\)/);
  assert.match(css, /\.inbox-message\{[\s\S]*border-radius:0!important/);
  assert.match(css, /th\{[\s\S]*font-family:var\(--tbg-display\)/);
});

test('design principle is documented as modern interaction with period football art direction', async () => {
  const doc = await read('docs/ui-design-principles.md');
  assert.match(doc, /2026 interaction design, 1982 football soul/);
  assert.match(doc, /classic game-screen composition/i);
  assert.match(doc, /Brazil palette remains part of TBG's identity/i);
  assert.match(doc, /should not behave like a retro website/i);
  assert.match(doc, /Avoid costume retro/);
  assert.match(doc, /website built in 1998/);
});
