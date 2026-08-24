import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('bootstrap cannot return legacy score state and manager messages are limited to the canonical world', async () => {
  const bootstrap = await read('netlify/functions/bootstrap.mjs');
  const projection = await read('src/world/managerPortalProjection.js');
  const fragmentMigration = await read('supabase/migrations/20260729_pr159_manager_portal_world_fragment.sql');

  assert.match(bootstrap, /get_manager_portal_world_fragment/);
  assert.match(fragmentMigration, /from public\.canonical_world_saves/);
  assert.match(bootstrap, /projectManagerPortal\(world, appointment\.club_id, \{/);
  assert.match(bootstrap, /nextTurnAt: context\.next_turn_at/);
  assert.match(bootstrap, /canonicalFixtureIds\(world\)/);
  assert.match(bootstrap, /message\.related_fixture_id/);
  assert.doesNotMatch(bootstrap, /save_envelope/);
  assert.doesNotMatch(bootstrap, /\/rest\/v1\/fixtures/);
  assert.doesNotMatch(bootstrap, /competition_standings/);
  assert.doesNotMatch(bootstrap, /manager_match_views/);
  assert.match(bootstrap, /function hideCompletedScore/);
  assert.match(bootstrap, /home_score: null/);
  assert.match(bootstrap, /away_score: null/);
  assert.match(bootstrap, /result_revealed: false/);

  assert.match(projection, /const score = result\?\.score \|\| null/);
  assert.match(projection, /home_score: score\?\.home \?\? null/);
  assert.match(projection, /away_score: score\?\.away \?\? null/);
  assert.match(projection, /result_revealed: Boolean\(result\)/);
});

test('skip to full time suppresses replay-completed auto finish', async () => {
  const source = await read('public/phase2d4.js');
  assert.match(source, /const tick = \(\{ autoFinish = true, ignoreHold = false, suppressSpotlight = false \} = \{\}\)/);
  assert.match(source, /tick\(\{ autoFinish: false, ignoreHold: true, suppressSpotlight: true \}\)/);
  assert.match(source, /finish\('skip_to_full_time'\)/);
});

test('engine attempts are recorded before either runner executes', async () => {
  const source = await read('netlify/functions/run-fixtures.mjs');
  const recordIndex = source.indexOf('const attemptCount = await recordRunAttempt');
  const executeIndex = source.search(/const\s+(?:rawResult|result)\s*=\s*ENGINE_RUNNER_URL/);
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
