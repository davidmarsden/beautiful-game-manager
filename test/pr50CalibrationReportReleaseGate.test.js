import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  runCalibrationReport,
  calibrationReportCsv,
  calibrationReportMarkdown
} from '../src/matchEngine/calibrationReport.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const dataset = await readJson('../calibration/gold-standard/match-engine-v1.json');
const baseline = await readJson('../calibration/baselines/release-gate-v1.json');
const report = runCalibrationReport({ dataset, baseline });

test('automatic calibration report passes every technical release section', () => {
  assert.equal(report.accepted, true, JSON.stringify({
    sections: report.section_acceptance,
    baseline: report.baseline_comparison,
    gate: report.release_gate
  }, null, 2));
  assert.equal(Object.values(report.section_acceptance).every(Boolean), true);
  assert.equal(report.baseline_comparison.accepted, true);
  assert.equal(report.release_gate.technical_gate_passed, true);
});

test('release gate does not perform the constitutional default cutover', () => {
  assert.equal(report.release_gate.shadow_comparison_complete, false);
  assert.equal(report.release_gate.constitutional_default_allowed, false);
  assert.equal(report.release_gate.decision, 'hold_for_shadow_comparison');
  assert.equal(report.release_gate.compatibility_fallback_required, true);
});

test('report renders reproducible JSON-compatible, CSV and Markdown artifacts', () => {
  assert.doesNotThrow(() => JSON.stringify(report));
  const csv = calibrationReportCsv(report);
  const markdown = calibrationReportMarkdown(report);
  assert.match(csv, /"section","metric","value","accepted"/);
  assert.match(csv, /release_gate/);
  assert.match(markdown, /TBG Constitutional Engine Calibration Report/);
  assert.match(markdown, /hold_for_shadow_comparison/);
  assert.match(markdown, /technical calibration gate passes/i);
});

test('baseline comparison blocks a material metric regression', () => {
  const impossibleBaseline = structuredClone(baseline);
  impossibleBaseline.metric_thresholds['match.average_total_goals'] = { minimum: 99, maximum: 100 };
  const blocked = runCalibrationReport({ dataset, baseline: impossibleBaseline });
  const markdown = calibrationReportMarkdown(blocked);
  assert.equal(blocked.baseline_comparison.metric_checks['match.average_total_goals'], false);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.release_gate.decision, 'blocked_by_calibration');
  assert.match(markdown, /technical calibration gate has failed/i);
  assert.doesNotMatch(markdown, /technical calibration gate passes/i);
});
