import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('refreshCaptain preserves the current captain while he remains in the XI', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const refreshCaptain = source.match(/function refreshCaptain\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(refreshCaptain, /const previousCaptainId = captain\.value/);
  assert.match(refreshCaptain, /const desired = selected\.map/);
  assert.match(refreshCaptain, /captain\.replaceChildren/);
  assert.match(refreshCaptain, /desired\.some\(\(option\) => option\.value === previousCaptainId\)/);
  assert.match(refreshCaptain, /captain\.value = previousCaptainId/);
  assert.ok(refreshCaptain.indexOf('previousCaptainId') < refreshCaptain.indexOf('captain.replaceChildren'));
  assert.ok(refreshCaptain.indexOf('captain.replaceChildren') < refreshCaptain.lastIndexOf('captain.value = previousCaptainId'));
});

test('refreshCaptain only falls back when the previous captain is no longer selected', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const refreshCaptain = source.match(/function refreshCaptain\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(refreshCaptain, /if \(previousCaptainId && desired\.some/);
  assert.doesNotMatch(refreshCaptain, /captain\.value = selected\[0\]/);
});
