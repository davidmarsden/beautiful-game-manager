import test from 'node:test';
import assert from 'node:assert/strict';
import { runShadowComparison, SHADOW_ACCEPTANCE } from '../src/matchEngine/shadowComparison.js';

test('shadow comparison uses paired deterministic fixtures and reconciles totals', () => {
  const report = runShadowComparison({ matchesPerScenario: 80 });
  assert.equal(report.generated_from_common_fixtures, true);
  assert.equal(report.matches_per_scenario, 80);
  assert.equal(report.total_matches, report.scenarios.length * 80);
  assert.equal(report.aggregate.compatibility.matches, report.total_matches);
  assert.equal(report.aggregate.constitutional.matches, report.total_matches);
});

test('both result producers preserve the established public result envelope', () => {
  const report = runShadowComparison({ matchesPerScenario: 80 });
  assert.equal(report.public_contract.compatible, true, JSON.stringify(report.public_contract.errors, null, 2));
  assert.equal(report.checks.public_contract_compatible, true);
});

test('shadow gate rejects malformed published event records', () => {
  const malformedSimulator = (contract) => ({
    result_version: '2d5-v1',
    run_key: contract.run_key,
    fixture_id: contract.fixture.fixture_id,
    status: 'completed',
    score: { home: 0, away: 0 },
    outcome: 'draw',
    events: [{ type: 'goal', side: 'home', minute: 12, commentary: 'A goal without a public ID.' }],
    statistics: {
      home: { shots: 1, shots_on_target: 1, possession: 50 },
      away: { shots: 1, shots_on_target: 1, possession: 50 }
    },
    model: { simulator: 'malformed-test-double' }
  });

  const report = runShadowComparison({ matchesPerScenario: 80, simulator: malformedSimulator });
  assert.equal(report.public_contract.compatible, false);
  assert.equal(report.checks.public_contract_compatible, false);
  assert.equal(report.accepted, false);
  assert.equal(report.recommendation, 'hold_for_shadow_review');
  assert.match(
    JSON.stringify(report.public_contract.errors),
    /events\[0\]\.event_id must be a non-empty string/
  );
});

test('shadow comparison publishes explicit bounded acceptance checks', () => {
  const report = runShadowComparison({ matchesPerScenario: 80 });
  assert.deepEqual(report.thresholds, SHADOW_ACCEPTANCE);
  assert.equal(typeof report.accepted, 'boolean');
  assert.equal(
    report.accepted,
    Object.values(report.checks).every(Boolean),
    JSON.stringify({ checks: report.checks, aggregate: report.aggregate }, null, 2)
  );
  assert.equal(
    report.recommendation,
    report.accepted ? 'ready_for_default_cutover_review' : 'hold_for_shadow_review'
  );
});

test('shadow comparison rejects undersized samples', () => {
  assert.throws(() => runShadowComparison({ matchesPerScenario: 79 }), /at least 80/);
});
