import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('unsaved captain selection survives portal refresh until save succeeds', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /let pendingCaptainId = null/);
  assert.match(source, /event\.target\?\.id !== 'captain'/);
  assert.match(source, /pendingCaptainId = playerId\(event\.target\.value\)/);
  assert.match(source, /tbg:portal-rendered/);
  assert.match(source, /requestAnimationFrame\(restorePendingCaptain\)/);
  assert.match(source, /tbg:team-submission-saved/);
  assert.match(source, /pendingCaptainId = null/);
  assert.match(source, /restorePendingCaptain\(\);\n    persistRenderedBoard\(\)/);
});
