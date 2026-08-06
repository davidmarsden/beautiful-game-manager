import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('unsaved captain selection survives portal refresh until save succeeds', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /let pendingCaptainId = null/);
  assert.match(source, /event\.target\?\.id !== 'captain'/);
  assert.match(source, /pendingCaptainId = playerId\(event\.target\.value\)/);
  assert.match(source, /document\.addEventListener\('change',[\s\S]*?\}, true\);/);
  assert.match(source, /tbg:portal-rendered/);
  assert.match(source, /requestAnimationFrame\(restorePendingCaptain\)/);
  assert.match(source, /tbg:team-submission-saved/);
  assert.match(source, /pendingCaptainId = null/);
  assert.match(source, /restorePendingCaptain\(\);\n    persistRenderedBoard\(\)/);
});

test('captain change is captured before synchronous formation rerender handlers', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  const listener = source.match(/document\.addEventListener\('change',[\s\S]*?\}, true\);/)?.[0] || '';
  assert.match(listener, /pendingCaptainId = playerId\(event\.target\.value\)/);
  assert.match(listener, /\}, true\);$/);
});

test('loading a preset or previous match replaces the pending captain override', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /tbg:team-sheet-override/);
  assert.match(source, /pendingCaptainId = null;\n  requestAnimationFrame\(replacePendingCaptainFromLoadedSheet\)/);
  assert.match(source, /setTimeout\(replacePendingCaptainFromLoadedSheet, 100\)/);
  assert.match(source, /#loadPreset, #loadPreviousMatch/);
  assert.match(source, /pendingCaptainId = captain \? playerId\(captain\.value\) \|\| null : null/);
});
