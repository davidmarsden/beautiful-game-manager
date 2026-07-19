import { mkdir, writeFile } from 'node:fs/promises';
import { simulateCompleteLeagueStructure, syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { rollOverPlayableLeague } from '../src/matchEngine/seasonRollover.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
const completed = simulateCompleteLeagueStructure({
  divisions,
  seasonId: 'rollover-calibration-season-one',
  startAt: '2026-08-01T15:00:00.000Z'
});
const report = rollOverPlayableLeague({
  divisions,
  completedReport: completed,
  movementCount: 1,
  nextSeasonId: 'rollover-calibration-season-two'
});

function markdown(result) {
  const lines = [
    '# Promotion, relegation and season rollover',
    '',
    `- Version: \`${result.version}\``,
    `- Completed season: \`${result.completed_season_id}\``,
    `- Next season: \`${result.next_season_id}\``,
    `- Movement per boundary: ${result.movement_count_per_boundary}`,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Movements',
    '',
    '| Club | From | To | Movement |',
    '|---|---|---|---|'
  ];
  for (const row of result.movements) lines.push(`| ${row.club_id} | ${row.from_division_id} | ${row.to_division_id} | ${row.movement} |`);
  lines.push('', '## Acceptance checks', '');
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('season-rollover.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('season-rollover.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: report.accepted,
  movements: report.movements.length,
  outputs: ['calibration/generated/season-rollover.json', 'calibration/generated/season-rollover.md']
}, null, 2));

if (!report.accepted) process.exitCode = 1;
