import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turn projects replay archives only after the canonical checkpoint commits', async () => {
  const source = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  const checkpointIndex = source.indexOf("tracker.begin('persist_canonical_checkpoint')");
  const projectionIndex = source.indexOf("tracker.begin('project_match_archives')");

  assert.ok(checkpointIndex >= 0, 'canonical checkpoint stage exists');
  assert.ok(projectionIndex > checkpointIndex, 'archive projection is post-commit');
  assert.match(source, /archiveRowsForCanonicalWorld/);
  assert.match(source, /readModelRowForCanonicalWorld/);
  assert.match(source, /status: 'deferred'/);
  assert.match(source, /five-minute projector remains the recovery path/);
});

test('match centre retries a just-finished fixture and distinguishes pending projection from missing archive', async () => {
  const source = await read('netlify/functions/match-centre.mjs');

  assert.match(source, /for \(let attempt = 0; attempt < 5 && !row; attempt \+= 1\)/);
  assert.match(source, /await sleep\(750\)/);
  assert.match(source, /completedFixtureStillProjecting/);
  assert.match(source, /code: 'archive_pending'/);
  assert.match(source, /Match replay is being prepared\. Try again in a moment\./);
  assert.match(source, /\}, 425\)/);
  assert.match(source, /code: 'archive_unavailable'/);
});
