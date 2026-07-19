import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCalibrationReport,
  calibrationReportCsv,
  calibrationReportMarkdown
} from '../src/matchEngine/calibrationReport.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const dataset = await readJson('calibration/gold-standard/match-engine-v1.json');
const baseline = await readJson('calibration/baselines/release-gate-v1.json');
const report = runCalibrationReport({ dataset, baseline });
const outputDir = resolve(root, 'calibration/generated');
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDir, 'calibration-report.json'), `${JSON.stringify(report, null, 2)}\n`),
  writeFile(resolve(outputDir, 'calibration-report.csv'), calibrationReportCsv(report)),
  writeFile(resolve(outputDir, 'calibration-report.md'), calibrationReportMarkdown(report))
]);
console.log(JSON.stringify({
  accepted: report.accepted,
  decision: report.release_gate.decision,
  output_dir: 'calibration/generated'
}));
if (!report.accepted) process.exitCode = 1;
