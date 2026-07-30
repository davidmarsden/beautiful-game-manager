import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('portal startup does not load the global monotonic submission guard', async () => {
  const html = await read('public/index.html');

  assert.doesNotMatch(html, /submission-state-monotonic-guard\.js/);
  assert.match(html, /portal-state-cache\.js/);
  assert.match(html, /phase2c2b\.js/);
  assert.match(html, /formation-board\.js/);
});

test('portal bootstrap flow remains available to normal startup consumers', async () => {
  const html = await read('public/index.html');
  const phase2c2bIndex = html.indexOf('phase2c2b.js');
  const formationIndex = html.indexOf('formation-board.js');

  assert.ok(phase2c2bIndex >= 0, 'phase2c2b must remain loaded');
  assert.ok(formationIndex > phase2c2bIndex, 'formation board must load after the base portal bootstrap consumer');
});
