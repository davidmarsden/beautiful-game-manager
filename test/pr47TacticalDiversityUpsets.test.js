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

test('live upset curve records the pre-PR49 calibration finding without weakening the validator', () => {
  const report = validateUpsetCurve({ gaps: [2, 4, 6, 10], matchesPerGap: 600 });
  assert.equal(report.total_matches, 2400);
  assert.equal(report.curves.length, 4);
  assert.equal(report.adjacent_steps.length, 3);
  for (const row of report.curves) {
    assert.ok(row.upset_rate > 0);
    assert.ok(row.stronger_win_rate < 1);
  }
  assert.equal(report.accepted, false, 'PR #49 must tune the live engine until every adjacent rating-gap step passes');
  assert.equal(
    report.checks.every_gap_step_preserves_stronger_team_trend && report.checks.every_gap_step_preserves_upset_trend,
    false,
    JSON.stringify(report, null, 2)
  );
});

test('upset validation rejects an intermediate regression even when endpoints improve', () => {
  const scriptedRates = new Map([
    [2, { wins: 35, draws: 30 }],
    [4, { wins: 39, draws: 30 }],
    [6, { wins: 44, draws: 30 }],
    [10, { wins: 40, draws: 30 }]
  ]);
  const counters = new Map();
  const simulator = (contract) => {
    const gap = Number(String(contract.run_key).split(':')[1]);
    const index = counters.get(gap) || 0;
    counters.set(gap, index + 1);
    const rates = scriptedRates.get(gap);
    const outcome = index < rates.wins ? 'win' : index < rates.wins + rates.draws ? 'draw' : 'loss';
    const strongerHome = index % 2 === 0;
    if (outcome === 'draw') return { score: { home: 1, away: 1 } };
    if (outcome === 'win') return { score: strongerHome ? { home: 1, away: 0 } : { home: 0, away: 1 } };
    return { score: strongerHome ? { home: 0, away: 1 } : { home: 1, away: 0 } };
  };

  const report = validateUpsetCurve({ gaps: [2, 4, 6, 10], matchesPerGap: 100, simulator });
  assert.equal(report.curves[3].stronger_win_rate > report.curves[0].stronger_win_rate, true);
  assert.equal(report.checks.every_gap_step_preserves_stronger_team_trend, false);
  assert.equal(report.accepted, false);
});

test('upset validation rejects undersized samples', () => {
  assert.throws(() => validateUpsetCurve({ matchesPerGap: 20 }), /at least 40/);
});
