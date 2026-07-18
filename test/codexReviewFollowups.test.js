import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('bootstrap never returns hidden raw score fields and sanitises all result messages', async () => {
  const source = await read('netlify/functions/bootstrap.mjs');
  assert.match(source, /const \{ home_score: homeScore, away_score: awayScore, \.\.\.safeRow \} = row/);
  assert.match(source, /\.\.\.\(revealed \? \{ home_score: homeScore, away_score: awayScore \} : \{\}\)/);
  assert.match(source, /resultMessageFixtureIds/);
  assert.match(source, /message\.message_type === 'match_result'/);
  assert.doesNotMatch(source, /const hiddenFixtureIds = new Set\(history/);
});

test('skip to full time suppresses replay-completed auto finish', async () => {
  const source = await read('public/phase2d4.js');
  assert.match(source, /const tick = \(\{ autoFinish = true \} = \{\}\)/);
  assert.match(source, /tick\(\{ autoFinish: false \}\)/);
  assert.match(source, /finish\('skip_to_full_time'\)/);
});

test('engine attempts are recorded before either runner executes', async () => {
  const source = await read('netlify/functions/run-fixtures.mjs');
  const recordIndex = source.indexOf('const attemptCount = await recordRunAttempt');
  const executeIndex = source.indexOf('const result = ENGINE_RUNNER_URL');
  assert.ok(recordIndex > -1 && executeIndex > recordIndex);
  assert.match(source, /status: 'submitted'/);
  assert.match(source, /attempt_count: attemptCount/);
});

test('preset capture follows the visible board and explicit loads release startup protection', async () => {
  const persistence = await read('public/formation-board-persistence-fix.js');
  const enhancements = await read('public/phase2c2b.js');
  assert.match(persistence, /#savePreset, #updatePreset/);
  assert.match(persistence, /persistRenderedBoard\(\)/);
  assert.match(enhancements, /#loadPreset, #loadPreviousMatch/);
  assert.match(enhancements, /stopSubmissionProtection\(\)/);
});