import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';
import { calibrationMetrics } from './calibration.js';
import { runGoldStandardStressTests } from './goldStandardStressTests.js';
import { buildTacticalDiversityMatrix, validateUpsetCurve } from './tacticalValidation.js';
import { simulateStatefulSeason, syntheticSeasonClubs } from './seasonSimulation.js';
import { runRatingBandValidation } from './ratingBandValidation.js';

export const CALIBRATION_REPORT_VERSION = 'tbg-calibration-report-v1.0';
export const RELEASE_GATE_VERSION = 'tbg-constitutional-release-gate-v1.0';

const POSITIONS = Object.freeze([
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger'
]);

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const text = (value) => String(value ?? '').trim();

function players(prefix, rating) {
  return POSITIONS.map((position, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix}-${index + 1}`,
    position,
    underlying_ability_rating: rating,
    work_rate: 60
  }));
}

function team(side, prefix) {
  return {
    side,
    club_id: prefix,
    club_name: prefix,
    formation: '4-3-3-wide',
    starting_xi: POSITIONS.map((_, index) => `${prefix}-${index + 1}`),
    bench: [],
    tactics: {
      style: 'balanced', route_to_goal: 'balanced', pressing: 'mid',
      tempo: 'normal', mentality: 'balanced'
    }
  };
}

function runMatchSection({ matches = 160, simulator = simulateMatch } = {}) {
  const rows = [];
  for (let index = 0; index < matches; index += 1) {
    const strongerSide = index % 2 === 0 ? 'home' : 'away';
    const homeRating = strongerSide === 'home' ? 92 : 86;
    const awayRating = strongerSide === 'away' ? 92 : 86;
    const homePrefix = `report-match-${index}-home`;
    const awayPrefix = `report-match-${index}-away`;
    const contract = {
      contract_version: '2d2-v1',
      engine_mode: MATCH_ENGINE_MODES.constitutional,
      rating_band_calibration: true,
      validation_scenario: 'pr50-match-calibration',
      run_key: `calibration-report:match:${index}`,
      fixture: {
        fixture_id: `calibration-report-match-${index}`,
        season_id: 'calibration-report',
        matchday: index + 1,
        kickoff_at: '2026-07-19T15:00:00.000Z'
      },
      teams: { home: team('home', homePrefix), away: team('away', awayPrefix) }
    };
    const world = { players: [...players(homePrefix, homeRating), ...players(awayPrefix, awayRating)] };
    const result = simulator(contract, world);
    rows.push({ score: result.score, stronger_side: strongerSide });
  }
  return calibrationMetrics(rows);
}

function metricAt(report, path) {
  const parts = path.split('.');
  let value = report;
  for (const part of parts) value = value?.[part];
  return Number(value);
}

function compareBaseline(report, baseline) {
  const sectionChecks = Object.fromEntries((baseline.required_sections || []).map((section) => [
    section,
    Boolean(report.sections?.[section]?.accepted) === Boolean(baseline.required_acceptance?.[section])
  ]));
  const metricChecks = Object.fromEntries(Object.entries(baseline.metric_thresholds || {}).map(([path, target]) => {
    const value = metricAt(report.release_metrics, path);
    return [path, Number.isFinite(value) && value >= target.minimum && value <= target.maximum];
  }));
  return Object.freeze({
    baseline_id: baseline.baseline_id,
    section_checks: Object.freeze(sectionChecks),
    metric_checks: Object.freeze(metricChecks),
    accepted: [...Object.values(sectionChecks), ...Object.values(metricChecks)].every(Boolean)
  });
}

function releaseMetrics(sections) {
  const eliteStandard = sections.rating_bands.scenarios.find((row) => row.scenario_id === 'd1-elite-v-d1-standard');
  const eliteFloor = sections.rating_bands.scenarios.find((row) => row.scenario_id === 'd1-elite-v-lower-floor');
  return Object.freeze({
    match: Object.freeze({ ...sections.match.metrics }),
    season: Object.freeze({ ...sections.season.metrics }),
    upsets: Object.freeze({ average_upset_rate: sections.upsets.average_upset_rate }),
    rating_bands: Object.freeze({
      d1_elite_v_d1_standard_win_rate: eliteStandard?.stronger_win_rate,
      d1_elite_v_lower_floor_win_rate: eliteFloor?.stronger_win_rate
    })
  });
}

export function runCalibrationReport({ dataset, baseline, simulator = simulateMatch } = {}) {
  if (!dataset) throw new Error('Calibration report requires the gold-standard dataset');
  if (!baseline?.baseline_id) throw new Error('Calibration report requires an accepted baseline');
  const sections = Object.freeze({
    match: runMatchSection({ simulator }),
    stress_tests: runGoldStandardStressTests(dataset),
    tactical: buildTacticalDiversityMatrix(),
    upsets: validateUpsetCurve({ gaps: [2, 4, 6, 10], matchesPerGap: 600, simulator }),
    season: simulateStatefulSeason({
      clubs: syntheticSeasonClubs({ clubCount: 6 }),
      seasonId: 'pr50-release-season',
      daysBetweenRounds: 4,
      simulator
    }),
    rating_bands: runRatingBandValidation({ matchesPerPair: 120, simulator })
  });
  const initial = {
    version: CALIBRATION_REPORT_VERSION,
    generated_at: 'deterministic',
    sections,
    release_metrics: releaseMetrics(sections)
  };
  const baselineComparison = compareBaseline(initial, baseline);
  const sectionAcceptance = Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Boolean(value.accepted)]));
  const technicalGatePassed = Object.values(sectionAcceptance).every(Boolean) && baselineComparison.accepted;
  const cutoverRequirements = baseline.cutover_requirements || {};
  const shadowComplete = cutoverRequirements.shadow_comparison_complete === true;
  const releaseGate = Object.freeze({
    version: RELEASE_GATE_VERSION,
    technical_gate_passed: technicalGatePassed,
    shadow_comparison_complete: shadowComplete,
    constitutional_default_allowed: technicalGatePassed && shadowComplete,
    compatibility_fallback_required: true,
    decision: technicalGatePassed && shadowComplete ? 'cutover_allowed' : technicalGatePassed ? 'hold_for_shadow_comparison' : 'blocked_by_calibration'
  });
  return Object.freeze({
    ...initial,
    baseline_comparison: baselineComparison,
    section_acceptance: Object.freeze(sectionAcceptance),
    release_gate: releaseGate,
    accepted: technicalGatePassed
  });
}

export function calibrationReportCsv(report) {
  const rows = [['section', 'metric', 'value', 'accepted']];
  for (const [section, accepted] of Object.entries(report.section_acceptance)) rows.push([section, 'section_accepted', accepted, accepted]);
  for (const [section, metrics] of Object.entries(report.release_metrics)) {
    for (const [metric, value] of Object.entries(metrics)) rows.push([section, metric, value, report.baseline_comparison.metric_checks[`${section}.${metric}`] ?? '']);
  }
  rows.push(['release_gate', 'decision', report.release_gate.decision, report.release_gate.technical_gate_passed]);
  return `${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')}\n`;
}

function cutoverBoundaryText(releaseGate) {
  if (releaseGate.constitutional_default_allowed) {
    return 'The release gate permits constitutional-v1 to become the default.';
  }
  if (releaseGate.technical_gate_passed) {
    return 'The technical calibration gate passes, but constitutional-v1 must remain opt-in until shadow comparison is complete.';
  }
  return 'The technical calibration gate has failed. Constitutional-v1 must remain opt-in until the reported calibration regressions are resolved.';
}

export function calibrationReportMarkdown(report) {
  const lines = [
    '# TBG Constitutional Engine Calibration Report',
    '',
    `- Report version: \`${report.version}\``,
    `- Baseline: \`${report.baseline_comparison.baseline_id}\``,
    `- Technical gate: **${report.release_gate.technical_gate_passed ? 'PASS' : 'FAIL'}**`,
    `- Cutover decision: **${text(report.release_gate.decision)}**`,
    '',
    '## Sections',
    ''
  ];
  for (const [section, accepted] of Object.entries(report.section_acceptance)) lines.push(`- ${section}: **${accepted ? 'PASS' : 'FAIL'}**`);
  lines.push('', '## Release metrics', '');
  for (const [section, metrics] of Object.entries(report.release_metrics)) {
    lines.push(`### ${section}`, '');
    for (const [metric, value] of Object.entries(metrics)) lines.push(`- ${metric}: ${round(value, 4)}`);
    lines.push('');
  }
  lines.push('## Cutover boundary', '', cutoverBoundaryText(report.release_gate), '');
  return `${lines.join('\n')}\n`;
}
