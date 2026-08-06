import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('unsaved captain selection survives portal refresh until save succeeds', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /let pendingCaptainId = null/);
  assert.match(source, /tbg:captain-selected/);
  assert.match(source, /pendingCaptainId = playerId\(event\.detail\?\.captain_id\) \|\| null/);
  assert.match(source, /tbg:portal-rendered/);
  assert.match(source, /requestAnimationFrame\(restorePendingCaptain\)/);
  assert.match(source, /tbg:team-submission-saved/);
  assert.match(source, /pendingCaptainId = null/);
  assert.match(source, /restorePendingCaptain\(\);\n    persistRenderedBoard\(\)/);
});

test('the earlier-loaded touch handler preserves captain before XI rerender', () => {
  const touch = fs.readFileSync(new URL('../public/formation-board-touch-fix.js', import.meta.url), 'utf8');
  const captainEvent = touch.indexOf("new CustomEvent('tbg:captain-selected'");
  const importCall = touch.indexOf("importHiddenTeamIntoBoard('captain_or_tactics_change')");
  assert.ok(captainEvent >= 0);
  assert.ok(importCall >= 0);
  assert.ok(captainEvent < importCall);
  assert.match(touch, /detail: \{ captain_id: id\(event\.target\.value\) \}/);
});

test('captain edit marker does not erase the captain captured in the same event cycle', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  const overrideListener = source.match(/document\.addEventListener\('tbg:team-sheet-override',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(overrideListener, /event\.detail\?\.source === 'captain_or_tactics_change'/);
  assert.match(overrideListener, /return;/);
  assert.ok(overrideListener.indexOf("captain_or_tactics_change") < overrideListener.indexOf('pendingCaptainId = null'));
});

test('trusted fallback cannot recapture the captain after synchronous select rebuild', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /let captainSelectionCapturedThisTurn = false/);
  assert.match(source, /captainSelectionCapturedThisTurn = true/);
  assert.match(source, /queueMicrotask\(\(\) => \{ captainSelectionCapturedThisTurn = false; \}\)/);
  const fallback = source.match(/document\.addEventListener\('change',[\s\S]*?\}, true\);/)?.[0] || '';
  assert.match(fallback, /if \(captainSelectionCapturedThisTurn\) return/);
  assert.ok(fallback.indexOf('captainSelectionCapturedThisTurn') < fallback.indexOf('pendingCaptainId = playerId(event.target.value)'));
});

test('loading a preset or previous match replaces the pending captain override', () => {
  const source = fs.readFileSync(new URL('../public/formation-board-persistence-fix.js', import.meta.url), 'utf8');
  assert.match(source, /tbg:team-sheet-override/);
  assert.match(source, /pendingCaptainId = null;\n  requestAnimationFrame\(replacePendingCaptainFromLoadedSheet\)/);
  assert.match(source, /setTimeout\(replacePendingCaptainFromLoadedSheet, 100\)/);
  assert.match(source, /#loadPreset, #loadPreviousMatch/);
  assert.match(source, /pendingCaptainId = captain \? playerId\(captain\.value\) \|\| null : null/);
});
