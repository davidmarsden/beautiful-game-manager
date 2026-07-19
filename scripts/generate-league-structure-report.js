import { mkdir, writeFile } from 'node:fs/promises';
import { simulateCompleteLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const report = simulateCompleteLeagueStructure();

function summary(result) {
  return {
    version: result.version,
    season_id: result.season_id,
    division_count: result.division_count,
    club_count: result.club_count,
    fixture_count: result.fixture_count,
    divisions: result.divisions.map((division) => ({
      division_id: division.division_id,
      level: division.level,
      average_starting_rating: division.average_starting_rating,
      club_count: division.club_count,
      fixture_count: division.fixture_count,
      standings: division.standings,
      metrics: division.metrics,
      checks: division.checks,
      accepted: division.accepted
    })),
    metrics: result.metrics,
    checks: result.checks,
    accepted: result.accepted
  };
}

function markdown(result) {
  const lines = [
    '# Complete Playable League Structure Report',
    '',
    `- Version: \`${result.version}\``,
    `- Season: \`${result.season_id}\``,
    `- Divisions: **${result.division_count}**`,
    `- Clubs: **${result.club_count}**`,
    `- Fixtures: **${result.fixture_count}**`,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Aggregate metrics',
    '',
    `- Total goals: ${result.metrics.total_goals}`,
    `- Average goals per match: ${result.metrics.average_goals_per_match}`,
    `- Unique public event IDs: ${result.metrics.unique_public_event_ids}`,
    `- Final fitness range: ${result.metrics.minimum_final_fitness}–${result.metrics.maximum_final_fitness}`,
    ''
  ];

  for (const division of result.divisions) {
    lines.push(
      `## ${division.division_id.toUpperCase()}`,
      '',
      `- Average starting rating: ${division.average_starting_rating}`,
      `- Clubs: ${division.club_count}`,
      `- Fixtures: ${division.fixture_count}`,
      `- Accepted: ${division.accepted ? 'PASS' : 'FAIL'}`,
      '',
      '| Pos | Club | P | W | D | L | GF | GA | GD | Pts |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|'
    );
    for (const row of division.standings) {
      lines.push(`| ${row.position} | ${row.club_id} | ${row.played} | ${row.won} | ${row.drawn} | ${row.lost} | ${row.gf} | ${row.ga} | ${row.gd} | ${row.points} |`);
    }
    lines.push('');
  }

  lines.push('## Acceptance checks', '');
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const output = summary(report);
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('league-structure-report.json', outputDirectory), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(new URL('league-structure-report.md', outputDirectory), markdown(output));

console.log(JSON.stringify({
  accepted: output.accepted,
  division_count: output.division_count,
  club_count: output.club_count,
  fixture_count: output.fixture_count,
  checks: output.checks,
  outputs: [
    'calibration/generated/league-structure-report.json',
    'calibration/generated/league-structure-report.md'
  ]
}, null, 2));

if (!output.accepted) process.exitCode = 1;
