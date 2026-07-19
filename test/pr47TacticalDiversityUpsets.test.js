import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TACTICAL_DIMENSIONS,
  tacticalPackages,
  buildTacticalDiversityMatrix,
  validateUpsetCurve
} from '../src/matchEngine/tacticalValidation.js';

test('tactical package registry covers every supported formation, style and route', () => {
  const packages = tacticalPackages();
  assert.equal(packages.length, TACTICAL_DIMENSIONS.formations.length * TACTICAL_DIMENSIONS.styles.length * TACTICAL_DIMENSIONS.routes.length);
  assert.equal(new Set(packages.map((row) => `${row.formation}|${row.style}|${row.route_to_goal}`)).size, packages.length);
});

test('full tactical matrix is bounded, countervailing and anti-dominant', () => {
  const report = buildTacticalDiversityMatrix();
  assert.equal(report.package_count, 126);
  assert.equal(report.matchup_count, 126 * 126);
  assert.equal(report.accepted, true, JSON.stringify({ champion: report.champion, checks: report.checks }, null, 2));
  assert.ok(report.unique_advantage_values >= 20);
  assert.ok(report.champion.worst_matchup < 0);
});

test('upset validation retains uncertainty while responding to rating gaps', () => {
  const report = validateUpsetCurve({ gaps: [2, 4, 6, 10], matchesPerGap: 120 });
  assert.equal(report.total_matches, 480);
  assert.equal(report.accepted, true, JSON.stringify(report, null, 2));
  assert.equal(report.curves.length, 4);
  for (const row of report.curves) {
    assert.ok(row.upset_rate > 0);
    assert.ok(row.stronger_win_rate < 1);
  }
});

test('upset validation rejects undersized samples', () => {
  assert.throws(() => validateUpsetCurve({ matchesPerGap: 20 }), /at least 40/);
});
