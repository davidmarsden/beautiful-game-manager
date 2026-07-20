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

const expiryTime = new Date(state.calendar.contract_expiry_at).getTime();
const expiringByClub = Object.fromEntries(Object.keys(state.clubs).map((clubId) => [
  clubId,
  state.clubs[clubId].player_ids.filter((playerId) => {
    const contract = state.contracts[state.players[playerId].contract_id];
    return contract.status === 'active' && new Date(contract.end_at).getTime() <= expiryTime;
  })
]));
const initialExpiringCount = Object.values(expiringByClub).flat().length;
const initialContractEndDates = new Set(Object.values(state.contracts).map((contract) => contract.end_at));

const transferredPlayerId = expiringByClub['club-1'][0];
transferPlayer(state, {
  playerId: transferredPlayerId,
  fromClubId: 'club-1',
  toClubId: 'club-2',
  at: '2026-07-15T12:00:00.000Z',
  fee: 5000000,
  wage: 25000,
  contractEndAt: '2030-06-30T23:59:59.000Z'
});

const renewedPlayerId = expiringByClub['club-3'][0];
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
const checks = Object.freeze({
  initial_contracts_are_staggered: initialContractEndDates.size === 5,
  normal_season_one_expiry_volume: initialExpiringCount === 8,
  transfer_and_renewal_protect_expiring_players: releasedPlayerIds.length === initialExpiringCount - 2,
  every_club_retains_viable_owned_squad: snapshot.clubs.every((club) => club.squad_size >= 18),
  squad_cycle_snapshot_accepted: snapshot.accepted
});

const report = Object.freeze({
  version: 'tbg-squad-cycle-foundation-report-v1.1',
  accepted: Object.values(checks).every(Boolean),
  calendar: state.calendar,
  contract_expiry: Object.freeze({
    initial_expiring_count: initialExpiringCount,
    initial_expiring_by_club: expiringByClub,
    distinct_initial_end_dates: initialContractEndDates.size,
    minimum_viable_owned_squad: 18
  }),
  actions: Object.freeze({
    transferred_player_id: transferredPlayerId,
    renewed_player_id: renewedPlayerId,
    youth_players_created: Object.values(youthIntakes).flat().length,
    released_player_count: releasedPlayerIds.length,
    released_player_ids: releasedPlayerIds
  }),
  checks,
  snapshot
});

const markdown = [
  '# TBG squad-cycle foundation report',
  '',
  `- Accepted: **${report.accepted}**`,
  `- Transfer windows: **${report.calendar.transfer_windows.length}**`,
  `- Registration deadlines: **${report.calendar.registration_deadlines.length}**`,
  `- Distinct initial contract end dates: **${report.contract_expiry.distinct_initial_end_dates}**`,
  `- Initially expiring this season: **${report.contract_expiry.initial_expiring_count}**`,
  `- Transfer completed: **${report.actions.transferred_player_id}**`,
  `- Contract renewed: **${report.actions.renewed_player_id}**`,
  `- Youth players created: **${report.actions.youth_players_created}**`,
  `- Expired contracts released: **${report.actions.released_player_count}**`,
  `- Free agents: **${report.snapshot.free_agent_count}**`,
  `- Events recorded: **${report.snapshot.event_count}**`,
  '',
  '## Squad-cycle checks',
  '',
  ...Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`),
  '',
  '## State integrity checks',
  '',
  ...Object.entries(report.snapshot.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`),
  ''
].join('\n');

fs.writeFileSync(path.join(outputDirectory, 'squad-cycle-foundations.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, 'squad-cycle-foundations.md'), markdown);

console.log(JSON.stringify({ accepted: report.accepted, actions: report.actions, checks: report.checks }, null, 2));
if (!report.accepted) process.exitCode = 1;
