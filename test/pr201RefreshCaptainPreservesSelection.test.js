import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('refreshCaptain preserves the current captain while he remains in the XI', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const refreshCaptain = source.match(/function refreshCaptain\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(refreshCaptain, /const previousCaptainId = captain\.value/);
  assert.match(refreshCaptain, /captain\.innerHTML = selected\.map/);
  assert.match(refreshCaptain, /selected\.some\(\(input\) => input\.value === previousCaptainId\)/);
  assert.match(refreshCaptain, /captain\.value = previousCaptainId/);
  assert.ok(refreshCaptain.indexOf('previousCaptainId') < refreshCaptain.indexOf('captain.innerHTML'));
  assert.ok(refreshCaptain.indexOf('captain.innerHTML') < refreshCaptain.lastIndexOf('captain.value = previousCaptainId'));
});

test('refreshCaptain only falls back when the previous captain is no longer selected', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const refreshCaptain = source.match(/function refreshCaptain\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(refreshCaptain, /if \(previousCaptainId && selected\.some/);
  assert.doesNotMatch(refreshCaptain, /captain\.value = selected\[0\]/);
});
