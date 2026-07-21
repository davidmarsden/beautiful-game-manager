import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlayableWorldReleaseCandidate,
  PLAYABLE_WORLD_RC_VERSION
} from '../src/release/playableWorldReleaseCandidate.js';

test('repeated-season persistence soak produces an accepted release candidate', () => {
  const report = buildPlayableWorldReleaseCandidate({
    seasons: 6,
    clubCount: 4,
    worldId: 'pr74-release-candidate'
  });

  assert.equal(report.version, PLAYABLE_WORLD_RC_VERSION);
  assert.equal(report.release_candidate, 'playable-world-rc1');
  assert.equal(report.accepted, true);
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.equal(report.metrics.archives_created, 6);
  assert.equal(report.metrics.final_season_number, 7);
  assert.equal(report.season_summaries.length, 6);
  assert.equal(report.season_summaries.every((row) => row.accepted), true);
  assert.equal(report.season_summaries.every((row) => row.next_squads_viable), true);
});

test('release-candidate soak is deterministic for the same world identity', () => {
  const first = buildPlayableWorldReleaseCandidate({ seasons: 4, clubCount: 4, worldId: 'pr74-determinism' });
  const second = buildPlayableWorldReleaseCandidate({ seasons: 4, clubCount: 4, worldId: 'pr74-determinism' });

  assert.deepEqual(first, second);
  assert.equal(first.checks.deterministic_full_run, true);
  assert.equal(first.checks.resumed_run_matches_continuous_run, true);
});

test('release candidate rejects a one-season non-soak run', () => {
  assert.throws(
    () => buildPlayableWorldReleaseCandidate({ seasons: 1 }),
    /at least two soak seasons/
  );
});
