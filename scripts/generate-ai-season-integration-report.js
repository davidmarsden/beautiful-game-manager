import fs from 'node:fs';
import path from 'node:path';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const output = simulateStatefulSeason({
  clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 88 }),
  seasonId: 'ai-season-integration-report'
});

const report = {
  version: 'tbg-ai-season-integration-report-v1.0',
  accepted: output.accepted,
  season_version: output.version,
  fixture_count: output.fixture_count,
  metrics: output.metrics,
  checks: output.checks,
  sample_decisions: output.results.slice(0, 2).map((result) => ({
    fixture_id: result.fixture.fixture_id,
    matchday: result.fixture.matchday,
    home: result.teams.home,
    away: result.teams.away
  }))
};

const directory = path.resolve('calibration/generated');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'ai-season-integration.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(directory, 'ai-season-integration.md'), [
  '# AI Season Integration Report',
  '',
  `- Accepted: ${report.accepted}`,
  `- Season version: ${report.season_version}`,
  `- Fixtures: ${report.fixture_count}`,
  `- Manager decisions: ${report.metrics.manager_decisions}`,
  `- Total rotations: ${report.metrics.total_rotations}`,
  `- Tactical adjustments: ${report.metrics.tactical_adjustments}`,
  `- Unavailable selections: ${report.metrics.unavailable_selections}`,
  '',
  '## Checks',
  '',
  ...Object.entries(report.checks).map(([check, accepted]) => `- ${accepted ? '✅' : '❌'} ${check}`),
  ''
].join('\n'));

console.log(JSON.stringify({ accepted: report.accepted, metrics: report.metrics, checks: report.checks }, null, 2));
if (!report.accepted) {
  const failedChecks = Object.entries(report.checks).filter(([, accepted]) => !accepted).map(([check]) => check);
  console.error(`AI season integration gate failed: ${failedChecks.join(', ')}`);
  process.exitCode = 1;
}
