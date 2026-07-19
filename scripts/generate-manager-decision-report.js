import { mkdir, writeFile } from 'node:fs/promises';
import { makeManagerDecision } from '../src/matchEngine/managerDecision.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const club = syntheticSeasonClubs({ clubCount: 4, baseRating: 88 })[0];
const state = Object.fromEntries(club.players.map((player, index) => [player.tbg_player_id, {
  fitness: index === 8 ? 58 : 92 - (index % 4),
  sharpness: 88
}]));
const previousStartingXi = club.players.slice(0, 11).map((player) => player.tbg_player_id);
const decision = makeManagerDecision({
  club,
  opponent: { average_rating: 92 },
  side: 'away',
  matchday: 6,
  playerState: state,
  previousStartingXi
});

const checks = {
  eleven_unique_starters: decision.starting_xi.length === 11 && new Set(decision.starting_xi).size === 11,
  bench_does_not_overlap: decision.bench.every((id) => !decision.starting_xi.includes(id)),
  tactical_plan_present: Boolean(decision.tactics.mentality && decision.tactics.pressing && decision.tactics.tempo),
  tired_player_can_be_rotated: decision.decision.rotation_count > 0,
  deterministic_replay: JSON.stringify(decision) === JSON.stringify(makeManagerDecision({
    club,
    opponent: { average_rating: 92 },
    side: 'away',
    matchday: 6,
    playerState: state,
    previousStartingXi
  }))
};

const output = {
  version: 'tbg-manager-decision-report-v1.0',
  accepted: Object.values(checks).every(Boolean),
  checks,
  decision
};

const markdown = [
  '# Manager Decision Report', '',
  `- Accepted: **${output.accepted ? 'PASS' : 'FAIL'}**`,
  `- Formation: ${decision.formation}`,
  `- Rotation count: ${decision.decision.rotation_count}`,
  `- Mentality: ${decision.tactics.mentality}`,
  `- Pressing: ${decision.tactics.pressing}`,
  `- Tempo: ${decision.tactics.tempo}`,
  '', '## Checks', '',
  ...Object.entries(checks).map(([key, value]) => `- ${key}: **${value ? 'PASS' : 'FAIL'}**`),
  '', '## Starting XI', '',
  ...decision.starting_xi.map((id) => `- ${id}`),
  ''
].join('\n');

const directory = new URL('../calibration/generated/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('manager-decision.json', directory), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(new URL('manager-decision.md', directory), markdown);
console.log(JSON.stringify({ accepted: output.accepted, checks }, null, 2));
if (!output.accepted) process.exitCode = 1;
