import { mkdir, writeFile } from 'node:fs/promises';
import {
  applyAvailabilityChanges,
  availabilitySnapshot,
  createSquadAvailability
} from '../src/matchEngine/squadAvailability.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const calendar = createSquadAvailability(['player-1', 'player-2', 'player-3', 'player-4']);

applyAvailabilityChanges(calendar, {
  state_changes: {
    injuries: [{ player_id: 'player-1', matches_out: 2, injury_type: 'hamstring' }],
    discipline: [
      { player_id: 'player-2', sent_off: true },
      { player_id: 'player-3', suspension_matches: 3 }
    ]
  }
}, { matchday: 5 });

const snapshots = [6, 7, 8, 9].map((matchday) => availabilitySnapshot(calendar, matchday));
const report = {
  version: calendar.version,
  scenarios: snapshots,
  checks: {
    injury_persists_for_declared_window: snapshots[0].unavailable.some((row) => row.player_id === 'player-1')
      && snapshots[1].unavailable.some((row) => row.player_id === 'player-1')
      && snapshots[2].available.some((row) => row.player_id === 'player-1'),
    red_card_suspension_clears_after_one_match: snapshots[0].unavailable.some((row) => row.player_id === 'player-2')
      && snapshots[1].available.some((row) => row.player_id === 'player-2'),
    explicit_suspension_persists_for_declared_window: snapshots.slice(0, 3).every((snapshot) => snapshot.unavailable.some((row) => row.player_id === 'player-3'))
      && snapshots[3].available.some((row) => row.player_id === 'player-3'),
    unaffected_player_remains_available: snapshots.every((snapshot) => snapshot.available.some((row) => row.player_id === 'player-4'))
  }
};
report.accepted = Object.values(report.checks).every(Boolean);

const markdown = [
  '# Squad Availability Calendar',
  '',
  `- Version: \`${report.version}\``,
  `- Gate: **${report.accepted ? 'PASS' : 'FAIL'}**`,
  '',
  '## Checks',
  '',
  ...Object.entries(report.checks).map(([name, passed]) => `- ${passed ? '✅' : '❌'} ${name}`),
  '',
  '## Matchday snapshots',
  '',
  '| Matchday | Available | Unavailable |',
  '|---:|---:|---:|',
  ...snapshots.map((snapshot) => `| ${snapshot.matchday} | ${snapshot.available.length} | ${snapshot.unavailable.length} |`),
  ''
].join('\n');

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('squad-availability.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('squad-availability.md', outputDirectory), `${markdown}\n`);
console.log(JSON.stringify({ accepted: report.accepted, checks: report.checks }, null, 2));
if (!report.accepted) process.exitCode = 1;
