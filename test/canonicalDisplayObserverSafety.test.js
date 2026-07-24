import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical display does not install a self-triggering mutation observer', async () => {
  const display = await read('public/canonical-display.js');
  assert.doesNotMatch(display, /new MutationObserver/);
  assert.doesNotMatch(display, /observe\(summary/);
});

test('world controls render the public canonical club name directly', async () => {
  const controls = await read('public/world-controls.js');
  assert.match(controls, /sharedState\.appointment\?\.club_name \|\| summary\.club_name/);
  assert.match(controls, /sharedState\.appointment\?\.club_id/);
});
