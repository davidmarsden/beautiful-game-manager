import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepresentativePersistentWorldReleaseCandidate,
  DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION
} from '../src/release/representativePersistentWorldReleaseCandidate.js';

test('accepts a representative five-division persistent world across two seasons', { timeout: 180000 }, () => {
  const report = buildRepresentativePersistentWorldReleaseCandidate({
    clubsPerDivision: DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION,
    seasons: 2,
    worldId: 'pr80-representative-world'
  });

  assert.equal(report.accepted, true);
  assert.equal(report.profile.divisions, 5);
  assert.equal(report.profile.clubs, 40);
  assert.equal(report.profile.seasons, 2);
  assert.equal(report.metrics.fixtures_completed, 560);
  assert.equal(report.metrics.archives_created, 10);
  assert.equal(report.metrics.movements_recorded, 16);
  assert.equal(report.metrics.final_season_number, 3);
  assert.equal(report.metrics.final_save_checksum, report.metrics.resumed_save_checksum);
  assert.equal(report.metrics.final_save_checksum, report.metrics.replayed_save_checksum);
  assert.equal(Object.values(report.checks).every(Boolean), true);
});

test('rejects profiles too small or short to qualify as a release candidate', () => {
  assert.throws(
    () => buildRepresentativePersistentWorldReleaseCandidate({ clubsPerDivision: 3, seasons: 2 }),
    /at least four clubs/
  );
  assert.throws(
    () => buildRepresentativePersistentWorldReleaseCandidate({ clubsPerDivision: 8, seasons: 1 }),
    /at least two seasons/
  );
});
