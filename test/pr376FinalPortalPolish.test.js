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

test('final polish fixes the feedback action and simplifies the masthead zones', async () => {
  const css = await read('public/portal-final-polish.css');
  assert.match(css, /\.alpha-feedback-button/);
  assert.match(css, /background:#2d6fa3!important/);
  assert.match(css, /border:1px solid #ffdc02!important/);
  assert.match(css, /#portal \.club-nav[\s\S]*background:#a8ca83!important/);
  assert.match(css, /#portal \.club-strip[\s\S]*margin-top:0!important/);
  assert.match(css, /#portal \.dashboard-grid[\s\S]*margin-top:0!important/);
  assert.match(css, /#portal \.tabs[\s\S]*background:#102330!important/);
});

test('News returns to lighter readable Brazil work surfaces', async () => {
  const css = await read('public/portal-final-polish.css');
  assert.match(css, /#portal #feedView[\s\S]*background:#9fc785!important/);
  assert.match(css, /#portal #feedView \.world-feed-item[\s\S]*background:#e7ece4!important/);
  assert.match(css, /world-feed-item:nth-child\(3n\+2\)[\s\S]*background:#dce5d8!important/);
  assert.match(css, /world-feed-item:nth-child\(3n\)[\s\S]*background:#d4e0e5!important/);
  assert.doesNotMatch(css.toLowerCase(), /#f8dfe8|#f5cfdd|#fcebf1|#f8dce7|#f6d5e2|#f9e3eb|#f2b9ce|#d986a8|#bd6488/);
});
