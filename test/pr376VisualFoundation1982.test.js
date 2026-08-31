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

test('legacy runtime themes and Football Pink do not override the final foundation', async () => {
  const community = await read('public/community-card.js');
  const html = await read('public/index.html');
  assert.doesNotMatch(community, /tbg-green-stock\.css/);
  assert.doesNotMatch(community, /tbg-brazil-polish\.css/);
  assert.doesNotMatch(html, /football-pink-stock\.css/);
  assert.match(community, /community-card\.css/);
  assert.match(community, /manager-contact\.css/);
});

test('visual foundation defines two greens two blues and restrained highlight tokens', async () => {
  const css = await read('public/design-1982.css');
  for (const token of ['--tbg-green-deep','--tbg-green','--tbg-green-mid','--tbg-navy-deep','--tbg-navy','--tbg-blue','--tbg-accent','--tbg-surface','--tbg-canvas']) {
    assert.match(css, new RegExp(token.replaceAll('-', '\\-')));
  }
  assert.match(css, /--tbg-green-deep:#164b2a/);
  assert.match(css, /--tbg-green:#267945/);
  assert.match(css, /--tbg-navy-deep:#102330/);
  assert.match(css, /--tbg-blue:#2d6fa3/);
  assert.match(css, /--tbg-accent:#ffdc02/);
  assert.match(css, /repeating-linear-gradient\(90deg,#205f36/);
});

test('visual foundation uses a compact tablet canvas without sacrificing phone width', async () => {
  const css = await read('public/design-1982.css');
  assert.match(css, /--tbg-canvas:920px/);
  assert.match(css, /\.shell\{[\s\S]*width:min\(calc\(100% - 150px\),var\(--tbg-canvas\)\)/);
  assert.match(css, /@media\(max-width:1100px\)[\s\S]*\.shell\{width:78vw\}/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.shell\{width:100%;padding-inline:7px\}/);
  assert.match(css, /\.panel\{[\s\S]*min-height:70px/);
  assert.match(css, /body\{[\s\S]*font-size:14px/);
});

test('visual foundation uses blue and green for structure and white yellow as highlights', async () => {
  const css = await read('public/design-1982.css');
  assert.match(css, /\.club-nav\{[\s\S]*background:#214f70/);
  assert.match(css, /\.tabs\{[\s\S]*background:var\(--tbg-navy-deep\)/);
  assert.match(css, /\.tabs button\.active\{[\s\S]*background:var\(--tbg-accent\)/);
  assert.match(css, /\.workspace\{[\s\S]*background:#eef3eb/);
  assert.match(css, /\.position-separator td\{[\s\S]*background:#fff1a8/);
  assert.match(css, /\.inbox-message\{[\s\S]*border-left:3px solid var\(--tbg-blue\)/);
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
