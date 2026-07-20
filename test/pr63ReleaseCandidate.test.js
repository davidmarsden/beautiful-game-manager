import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_RELEASE_EVIDENCE,
  CONSTITUTIONAL_ENGINE_MONITORING,
  CONSTITUTIONAL_ENGINE_ROLLBACK,
  buildConstitutionalReleaseCandidate
} from '../src/matchEngine/releaseCandidate.js';
import { DEFAULT_MATCH_ENGINE_MODE, MATCH_ENGINE_MODES } from '../src/matchSimulation.js';

function acceptedEvidence() {
  return Object.fromEntries(REQUIRED_RELEASE_EVIDENCE.map((requirement) => {
    if (requirement.key === 'calibration') return [requirement.key, { version: 'calibration', sections: { match: { accepted: true }, stress: { accepted: true } } }];
    if (requirement.key === 'multi_season') return [requirement.key, { version: 'soak', metrics: { seasons_completed: 50 }, checks: { completed: true, preserved: true } }];
    return [requirement.key, { version: requirement.key, accepted: true }];
  }));
}

test('constitutional mode remains the default and compatibility remains the explicit rollback', () => {
  assert.equal(DEFAULT_MATCH_ENGINE_MODE, MATCH_ENGINE_MODES.constitutional);
  assert.equal(CONSTITUTIONAL_ENGINE_ROLLBACK.default_mode, MATCH_ENGINE_MODES.constitutional);
  assert.equal(CONSTITUTIONAL_ENGINE_ROLLBACK.fallback_mode, MATCH_ENGINE_MODES.compatibility);
  assert.match(CONSTITUTIONAL_ENGINE_ROLLBACK.activation, /engine_mode.*compatibility/i);
});

test('release candidate accepts only when every required artifact is present and accepted', () => {
  const report = buildConstitutionalReleaseCandidate({ evidence: acceptedEvidence(), commitSha: 'abc123' });
  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.artifacts.length, REQUIRED_RELEASE_EVIDENCE.length);
  assert.ok(report.artifacts.every((artifact) => artifact.present && artifact.accepted));
});

test('missing or failed evidence blocks release candidate acceptance', () => {
  const missing = acceptedEvidence();
  delete missing.shadow;
  const missingReport = buildConstitutionalReleaseCandidate({ evidence: missing });
  assert.equal(missingReport.accepted, false);
  assert.equal(missingReport.checks.every_required_artifact_present, false);

  const failed = acceptedEvidence();
  failed.final_outcomes = { version: 'failed', accepted: false };
  const failedReport = buildConstitutionalReleaseCandidate({ evidence: failed });
  assert.equal(failedReport.accepted, false);
  assert.equal(failedReport.checks.every_required_artifact_accepted, false);
});

test('monitoring contract gives hard invariants zero tolerance', () => {
  const alerts = CONSTITUTIONAL_ENGINE_MONITORING.release_alerts;
  assert.equal(alerts.unavailable_selections_maximum, 0);
  assert.equal(alerts.duplicate_state_applications_maximum, 0);
  assert.equal(alerts.public_contract_errors_maximum, 0);
  assert.equal(alerts.manager_decisions_per_fixture, 2);
});
