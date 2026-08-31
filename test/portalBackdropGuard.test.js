import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated portal paints a full-height TBG backdrop without loading legacy Football Pink stock', async () => {
  const [index, authCss, foundationCss] = await Promise.all([
    read('public/index.html'),
    read('public/auth-fix.css'),
    read('public/design-1982.css')
  ]);

  assert.match(index, /<link rel="stylesheet" href="\.\/auth-fix\.css">/);
  assert.doesNotMatch(index, /<link rel="stylesheet" href="\.\/football-pink-stock\.css">/);
  assert.match(index, /<link rel="stylesheet" href="\.\/design-1982\.css">/);
  assert.match(foundationCss, /html\{background:#246b3b\}/);

  assert.match(authCss, /#portal:not\(\[hidden\]\)\s*\{/);
  assert.match(authCss, /#portal:not\(\[hidden\]\)[\s\S]*min-height:\s*100vh/);
  assert.match(authCss, /#portal:not\(\[hidden\]\)[\s\S]*#9fc785/);
});
