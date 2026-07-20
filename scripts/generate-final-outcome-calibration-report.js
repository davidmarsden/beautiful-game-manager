import { mkdir, writeFile } from 'node:fs/promises';
import { runFinalOutcomeCalibration } from '../src/matchEngine/finalOutcomeCalibration.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const report = runFinalOutcomeCalibration({ matchesPerScenario: 1000 });

function markdown(result) {
  const lines = [
    '# Final rating-gap, home-advantage and upset-frequency calibration',
    '',
    `- Version: \`${result.version}\``,
    `- Matches per scenario: ${result.matches_per_scenario}`,
    `- Total matches: ${result.total_matches}`,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Scenarios',
    '',
    '| Scenario | Gap | Avg goals | Home win | Away win | Draw | Home edge | Stronger win | Stronger non-loss | Upset |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const scenario of result.scenarios) {
    lines.push(`| ${scenario.scenario_id} | ${scenario.rating_gap} | ${scenario.average_goals_per_match} | ${scenario.home_win_rate} | ${scenario.away_win_rate} | ${scenario.draw_rate} | ${scenario.home_win_advantage} | ${scenario.stronger_win_rate ?? '—'} | ${scenario.stronger_non_loss_rate ?? '—'} | ${scenario.upset_rate ?? '—'} |`);
  }
  lines.push('', '## Acceptance checks', '');
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('final-outcome-calibration.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('final-outcome-calibration.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: report.accepted,
  total_matches: report.total_matches,
  outputs: [
    'calibration/generated/final-outcome-calibration.json',
    'calibration/generated/final-outcome-calibration.md'
  ]
}, null, 2));

if (!report.accepted) process.exitCode = 1;
