import { mkdir, writeFile } from 'node:fs/promises';
import { playHumanManagerSeason } from '../src/matchEngine/humanManagerSeason.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const clubs = syntheticSeasonClubs({ clubCount: 6, baseRating: 88 });
const humanClubId = clubs[0].club_id;
const report = playHumanManagerSeason({
  clubs,
  humanClubId,
  seasonId: 'human-manager-release-season',
  defaultInstruction: {
    formation: '4-3-3-wide',
    tactics: {
      style: 'possession',
      route_to_goal: 'wide',
      pressing: 'mid',
      tempo: 'normal',
      mentality: 'balanced'
    }
  },
  instructionsByMatchday: {
    1: { tactics: { mentality: 'positive', pressing: 'high' } },
    5: { tactics: { mentality: 'cautious', pressing: 'low', tempo: 'slow' } },
    6: { formation: '4-2-3-1', tactics: { route_to_goal: 'central', mentality: 'balanced' } },
    10: { formation: '4-3-3-wide', tactics: { mentality: 'attacking', tempo: 'fast' } }
  }
});

function markdown(result) {
  const lines = [
    '# Minimum end-to-end human manager season',
    '',
    `- Version: \`${result.version}\``,
    `- Season: \`${result.season_id}\``,
    `- Human club: \`${result.human_club_id}\``,
    `- Final position: **${result.final_standing.position}**`,
    `- Record: **${result.final_standing.won}-${result.final_standing.drawn}-${result.final_standing.lost}**`,
    `- Points: **${result.final_standing.points}**`,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Human-managed fixtures',
    '',
    '| MD | Venue | Opponent | Result | Formation | Mentality |',
    '|---:|---|---|---|---|---|'
  ];
  for (const row of result.results) {
    lines.push(`| ${row.matchday} | ${row.venue} | ${row.opponent_club_id} | ${row.goals_for}-${row.goals_against} (${row.result}) | ${row.formation} | ${row.tactics.mentality} |`);
  }
  lines.push('', '## Acceptance checks', '');
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('human-manager-season.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('human-manager-season.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: report.accepted,
  human_club_id: report.human_club_id,
  fixtures: report.results.length,
  final_position: report.final_standing.position,
  outputs: ['calibration/generated/human-manager-season.json', 'calibration/generated/human-manager-season.md']
}, null, 2));

if (!report.accepted) process.exitCode = 1;
