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
