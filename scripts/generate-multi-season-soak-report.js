import { mkdir, writeFile } from 'node:fs/promises';
import { runMultiSeasonSoak } from '../src/matchEngine/multiSeasonSoak.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const report = runMultiSeasonSoak({
  seasonCount: 50,
  firstSeasonId: 'multi-season-soak-1'
});

function markdown(result) {
  const lines = [
    '# Multi-season autonomous soak test',
    '',
    `- Version: \`${result.version}\``,
    `- Seasons: ${result.season_count}`,
    `- Fixtures: ${result.metrics.fixtures_played}`,
    `- Rollovers: ${result.metrics.rollovers_completed}`,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Aggregate metrics',
    '',
    `- Average goals per match: ${result.metrics.average_goals_per_match}`,
    `- Home win rate: ${result.metrics.home_win_rate}`,
    `- Away win rate: ${result.metrics.away_win_rate}`,
    `- Draw rate: ${result.metrics.draw_rate}`,
    `- Manager decisions: ${result.metrics.manager_decisions}`,
    `- Emergency youth call-ups: ${result.metrics.emergency_youth_callups}`,
    `- Out-of-position starters: ${result.metrics.out_of_position_starters}`,
    `- Unique champions: ${result.metrics.unique_champions}`,
    `- Clubs visiting multiple divisions: ${result.metrics.clubs_visiting_multiple_divisions}`,
    '',
    '## Acceptance checks',
    ''
  ];
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push('', '## Season summary', '', '| Season | Fixtures | Goals | Accepted |', '|---:|---:|---:|:---:|');
  for (const season of result.season_summaries) {
    lines.push(`| ${season.season_number} | ${season.fixture_count} | ${season.goals} | ${season.accepted ? '✅' : '❌'} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('multi-season-soak.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('multi-season-soak.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: report.accepted,
  seasons: report.season_count,
  fixtures: report.metrics.fixtures_played,
  rollovers: report.metrics.rollovers_completed,
  outputs: ['calibration/generated/multi-season-soak.json', 'calibration/generated/multi-season-soak.md']
}, null, 2));

if (!report.accepted) process.exitCode = 1;
