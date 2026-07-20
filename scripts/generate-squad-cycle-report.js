import fs from 'node:fs';
import path from 'node:path';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import {
  createSquadCycleState,
  generateYouthIntake,
  processContractExpiries,
  renewContract,
  squadCycleSnapshot,
  transferPlayer
} from '../src/squadCycle/squadCycle.js';

const outputDirectory = path.resolve('calibration/generated');
fs.mkdirSync(outputDirectory, { recursive: true });

const state = createSquadCycleState({
  clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
  seasonId: 'squad-cycle-foundation-season',
  seasonStart: '2026-08-01T00:00:00.000Z',
  seasonEnd: '2027-06-30T23:59:59.000Z'
});

const transferredPlayerId = state.clubs['club-1'].player_ids[0];
transferPlayer(state, {
  playerId: transferredPlayerId,
  fromClubId: 'club-1',
  toClubId: 'club-2',
  at: '2026-07-15T12:00:00.000Z',
  fee: 5000000,
  wage: 25000,
  contractEndAt: '2030-06-30T23:59:59.000Z'
});

const renewedPlayerId = state.clubs['club-3'].player_ids[0];
renewContract(state, {
  playerId: renewedPlayerId,
  clubId: 'club-3',
  at: '2027-05-01T12:00:00.000Z',
  endAt: '2030-06-30T23:59:59.000Z',
  wage: 22000
});

const youthIntakes = Object.fromEntries(Object.keys(state.clubs).map((clubId) => [clubId, generateYouthIntake(state, { clubId })]));
const releasedPlayerIds = processContractExpiries(state);
const snapshot = squadCycleSnapshot(state);

const report = Object.freeze({
  version: 'tbg-squad-cycle-foundation-report-v1.0',
  accepted: snapshot.accepted,
  calendar: state.calendar,
  actions: Object.freeze({
    transferred_player_id: transferredPlayerId,
    renewed_player_id: renewedPlayerId,
    youth_players_created: Object.values(youthIntakes).flat().length,
    released_player_count: releasedPlayerIds.length,
    released_player_ids: releasedPlayerIds
  }),
  snapshot
});

const markdown = [
  '# TBG squad-cycle foundation report',
  '',
  `- Accepted: **${report.accepted}**`,
  `- Transfer windows: **${report.calendar.transfer_windows.length}**`,
  `- Registration deadlines: **${report.calendar.registration_deadlines.length}**`,
  `- Transfer completed: **${report.actions.transferred_player_id}**`,
  `- Contract renewed: **${report.actions.renewed_player_id}**`,
  `- Youth players created: **${report.actions.youth_players_created}**`,
  `- Expired contracts released: **${report.actions.released_player_count}**`,
  `- Free agents: **${report.snapshot.free_agent_count}**`,
  `- Events recorded: **${report.snapshot.event_count}**`,
  '',
  '## Integrity checks',
  '',
  ...Object.entries(report.snapshot.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`),
  ''
].join('\n');

fs.writeFileSync(path.join(outputDirectory, 'squad-cycle-foundations.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, 'squad-cycle-foundations.md'), markdown);

console.log(JSON.stringify({ accepted: report.accepted, actions: report.actions, checks: report.snapshot.checks }, null, 2));
if (!report.accepted) process.exitCode = 1;
