export const CONSTITUTIONAL_RELEASE_CANDIDATE_VERSION = 'tbg-constitutional-release-candidate-v1.0';

export const REQUIRED_RELEASE_EVIDENCE = Object.freeze([
  Object.freeze({ key: 'calibration', filename: 'calibration-report.json', acceptedPath: ['sections'], description: 'Core match, stress and tactical calibration' }),
  Object.freeze({ key: 'shadow', filename: 'shadow-comparison.json', acceptedPath: ['accepted'], description: 'Compatibility-versus-constitutional shadow comparison' }),
  Object.freeze({ key: 'league_structure', filename: 'league-structure-report.json', acceptedPath: ['accepted'], description: 'Complete five-division league structure' }),
  Object.freeze({ key: 'season_rollover', filename: 'season-rollover.json', acceptedPath: ['accepted'], description: 'Promotion, relegation and season rollover' }),
  Object.freeze({ key: 'season_availability', filename: 'season-availability-integration.json', acceptedPath: ['accepted'], description: 'Injury and suspension availability integration' }),
  Object.freeze({ key: 'manager_decisions', filename: 'manager-decision.json', acceptedPath: ['accepted'], description: 'Deterministic AI manager decisions' }),
  Object.freeze({ key: 'ai_season', filename: 'ai-season-integration.json', acceptedPath: ['accepted'], description: 'Autonomous AI-managed season integration' }),
  Object.freeze({ key: 'multi_season', filename: 'multi-season-soak.json', acceptedPath: ['checks'], description: 'Fifty-season autonomous soak' }),
  Object.freeze({ key: 'final_outcomes', filename: 'final-outcome-calibration.json', acceptedPath: ['accepted'], description: 'Final rating-gap, home-advantage and upset calibration' })
]);

export const CONSTITUTIONAL_ENGINE_ROLLBACK = Object.freeze({
  default_mode: 'constitutional-v1',
  fallback_mode: 'compatibility',
  activation: 'Set engine_mode or match_engine_mode to compatibility on each match contract.',
  scope: 'New matches only; already-resolved matches are immutable and must not be replayed in place.',
  preserve: Object.freeze([
    'fixture identity and run key',
    'public result envelope',
    'persisted match state and audit records',
    'calibration artifacts from the failed release'
  ]),
  exit_criteria: Object.freeze([
    'incident identified and documented',
    'constitutional fix covered by a regression test',
    'complete calibration gate green',
    'shadow comparison accepted',
    'release-candidate evidence regenerated'
  ])
});

export const CONSTITUTIONAL_ENGINE_MONITORING = Object.freeze({
  metrics: Object.freeze([
    'matches_resolved_total',
    'resolution_failures_total',
    'average_goals_per_match',
    'home_win_rate',
    'draw_rate',
    'stronger_team_non_loss_rate',
    'emergency_youth_per_team_fixture',
    'out_of_position_starters_total',
    'unavailable_selections_total',
    'duplicate_state_applications_total',
    'manager_decisions_per_fixture',
    'public_contract_errors_total'
  ]),
  release_alerts: Object.freeze({
    resolution_failure_rate_maximum: 0,
    average_goals_per_match: Object.freeze({ minimum: 1.5, maximum: 3.5 }),
    draw_rate: Object.freeze({ minimum: 0.15, maximum: 0.40 }),
    home_win_rate: Object.freeze({ minimum: 0.20, maximum: 0.55 }),
    emergency_youth_per_team_fixture_maximum: 0.20,
    unavailable_selections_maximum: 0,
    duplicate_state_applications_maximum: 0,
    manager_decisions_per_fixture: 2,
    public_contract_errors_maximum: 0
  }),
  response: Object.freeze({
    warning: 'Investigate drift and compare against the accepted release-candidate artifacts.',
    rollback: 'Switch new contracts to compatibility mode when a hard invariant fails or public results cannot be trusted.'
  })
});

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function acceptedEvidence(requirement, report) {
  if (!report || typeof report !== 'object') return false;
  if (requirement.key === 'calibration') {
    const sections = report.sections || {};
    return Object.keys(sections).length > 0 && Object.values(sections).every((section) => section?.accepted !== false);
  }
  if (requirement.key === 'multi_season') {
    return report.metrics?.seasons_completed >= 50 && Object.values(report.checks || {}).every(Boolean);
  }
  return readPath(report, requirement.acceptedPath) === true;
}

export function buildConstitutionalReleaseCandidate({ evidence = {}, commitSha = 'unknown' } = {}) {
  const artifacts = REQUIRED_RELEASE_EVIDENCE.map((requirement) => {
    const report = evidence[requirement.key];
    return Object.freeze({
      key: requirement.key,
      filename: requirement.filename,
      description: requirement.description,
      present: Boolean(report),
      version: report?.version || null,
      accepted: acceptedEvidence(requirement, report)
    });
  });
  const checks = Object.freeze({
    every_required_artifact_present: artifacts.every((artifact) => artifact.present),
    every_required_artifact_accepted: artifacts.every((artifact) => artifact.accepted),
    rollback_mode_recorded: CONSTITUTIONAL_ENGINE_ROLLBACK.fallback_mode === 'compatibility',
    constitutional_mode_recorded: CONSTITUTIONAL_ENGINE_ROLLBACK.default_mode === 'constitutional-v1',
    monitoring_contract_recorded: CONSTITUTIONAL_ENGINE_MONITORING.metrics.length >= 10,
    hard_invariants_have_zero_tolerance:
      CONSTITUTIONAL_ENGINE_MONITORING.release_alerts.unavailable_selections_maximum === 0
      && CONSTITUTIONAL_ENGINE_MONITORING.release_alerts.duplicate_state_applications_maximum === 0
      && CONSTITUTIONAL_ENGINE_MONITORING.release_alerts.public_contract_errors_maximum === 0
  });
  return Object.freeze({
    version: CONSTITUTIONAL_RELEASE_CANDIDATE_VERSION,
    candidate: 'constitutional-engine-rc1',
    commit_sha: commitSha,
    engine_mode: CONSTITUTIONAL_ENGINE_ROLLBACK.default_mode,
    fallback_mode: CONSTITUTIONAL_ENGINE_ROLLBACK.fallback_mode,
    artifacts: Object.freeze(artifacts),
    rollback: CONSTITUTIONAL_ENGINE_ROLLBACK,
    monitoring: CONSTITUTIONAL_ENGINE_MONITORING,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
