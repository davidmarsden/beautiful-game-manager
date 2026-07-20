import fs from 'node:fs';
import path from 'node:path';
import { analyseWorldSquads } from '../src/intelligence/squadIntelligence.js';
import { createSquadCycleState, generateYouthIntake, unregisterPlayer } from '../src/squadCycle/squadCycle.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const outputDirectory = path.resolve('calibration/generated');
fs.mkdirSync(outputDirectory, { recursive: true });

const state = createSquadCycleState({
  clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
  seasonId: 'squad-intelligence-foundation-season',
  seasonStart: '2026-08-01T00:00:00.000Z',
  seasonEnd: '2027-06-30T23:59:59.000Z'
});

for (const clubId of Object.keys(state.clubs)) generateYouthIntake(state, { clubId });

const removedDefenderId = state.clubs['club-1'].registered_player_ids.find((id) => state.players[id].position === 'Centre-Back');
unregisterPlayer(state, { clubId: 'club-1', playerId: removedDefenderId, at: '2026-08-20T12:00:00.000Z', reason: 'intelligence_evidence' });

const unavailableId = state.clubs['club-2'].registered_player_ids.find((id) => state.players[id].position === 'Goalkeeper');
const reports = analyseWorldSquads(state, {
  at: '2026-08-20T12:00:00.000Z',
  availability: { [unavailableId]: { available: false, reason: 'injured' } }
});

const clubOne = reports.find((row) => row.club_id === 'club-1');
const clubTwo = reports.find((row) => row.club_id === 'club-2');
const checks = Object.freeze({
  every_club_analysed_once: reports.length === Object.keys(state.clubs).length && new Set(reports.map((row) => row.club_id)).size === reports.length,
  player_roles_present: reports.every((report) => report.players.every((player) => Boolean(player.squad_role))),
  contract_horizons_present: reports.every((report) => report.players.every((player) => Boolean(player.contract_horizon))),
  unregistered_youth_not_counted_as_senior_cover: reports.every((report) => report.summary.registered_seniors === 19 - (report.club_id === 'club-1' ? 1 : 0)),
  structural_gap_identified: clubOne.needs.some((row) => row.type === 'position_group' && row.group === 'defender'),
  temporary_gap_identified: clubTwo.needs.some((row) => row.type === 'temporary_availability' && row.group === 'goalkeeper'),
  deterministic_world_order: reports.map((row) => row.club_id).join(',') === 'club-1,club-2,club-3,club-4'
});

const report = Object.freeze({
  version: 'tbg-squad-intelligence-report-v1.0',
  accepted: Object.values(checks).every(Boolean),
  checks,
  evidence: Object.freeze({ removed_defender_id: removedDefenderId, unavailable_goalkeeper_id: unavailableId }),
  clubs: reports
});

const markdown = [
  '# TBG squad intelligence report',
  '',
  `- Accepted: **${report.accepted}**`,
  `- Clubs analysed: **${report.clubs.length}**`,
  `- Structural gap exposed: **${report.evidence.removed_defender_id}**`,
  `- Temporary availability gap exposed: **${report.evidence.unavailable_goalkeeper_id}**`,
  '',
  '## Acceptance checks',
  '',
  ...Object.entries(checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`),
  '',
  '## Club summaries',
  '',
  ...report.clubs.flatMap((club) => [
    `### ${club.club_id}`,
    '',
    `- Registered seniors: **${club.summary.registered_seniors}**`,
    `- Available seniors: **${club.summary.available_seniors}**`,
    `- Expiring this season: **${club.summary.expiring_this_season}**`,
    `- Viable: **${club.viable}**`,
    `- Needs: **${club.needs.length}**`,
    ''
  ])
].join('\n');

fs.writeFileSync(path.join(outputDirectory, 'squad-intelligence.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, 'squad-intelligence.md'), markdown);
console.log(JSON.stringify({ accepted: report.accepted, checks }, null, 2));
if (!report.accepted) process.exitCode = 1;
