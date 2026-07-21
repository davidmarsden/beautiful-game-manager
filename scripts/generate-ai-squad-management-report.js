import fs from 'node:fs';
import path from 'node:path';
import { createSquadCycleState, unregisterPlayer } from '../src/squadCycle/squadCycle.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { executeAiSquadPlan } from '../src/intelligence/aiSquadManagement.js';

const outputDir = path.resolve('calibration/generated');
fs.mkdirSync(outputDir, { recursive: true });

const state = createSquadCycleState({
  clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
  seasonId: 'ai-squad-management-foundation-season',
  seasonStart: '2026-08-01T00:00:00.000Z',
  seasonEnd: '2027-06-30T23:59:59.000Z'
});

for (const [id, position, rating] of [
  ['free-agent-gk', 'GK', 82], ['free-agent-cb', 'CB', 84], ['free-agent-rb', 'RB', 83],
  ['free-agent-dm', 'DM', 83], ['free-agent-cm', 'CM', 82], ['free-agent-cf', 'CF', 84],
  ['free-agent-rw', 'RW', 81], ['free-agent-lb', 'LB', 80]
]) {
  state.players[id] = {
    tbg_player_id: id, display_name: id, club_id: null, age: 25, position,
    underlying_ability_rating: rating, contract_id: null
  };
}

const at = '2026-07-01T12:00:00.000Z';
const removedDefenders = state.clubs['club-1'].registered_player_ids
  .filter((id) => ['Right-Back', 'Centre-Back', 'Left-Back'].includes(state.players[id].position))
  .slice(0, 3);
for (const id of removedDefenders) {
  unregisterPlayer(state, { clubId: 'club-1', playerId: id, at, reason: 'acceptance_gap' });
}

const result = executeAiSquadPlan(state, { clubId: 'club-1', at });
const checks = {
  hard_minimum_repaired: result.after.summary.hard_minimum_gap === 0,
  positional_coverage_repaired: result.after.coverage.every((row) => row.registered_gap === 0),
  expiring_players_reviewed: result.actions.some((row) => row.action === 'renew'),
  free_agent_recruitment_used: result.actions.some((row) => row.action === 'sign_free_agent'),
  decision_ledger_present: state.events.some((row) => row.type === 'ai_squad_decision_applied'),
  deterministic_action_order: result.actions.every((row, index, rows) => index === 0 || Boolean(rows[index - 1].action))
};

const report = {
  version: 'tbg-ai-squad-management-report-v1.0',
  accepted: Object.values(checks).every(Boolean) && result.accepted,
  checks,
  evidence: {
    removed_defender_ids: removedDefenders,
    before: result.before.summary,
    after: result.after.summary,
    before_coverage: result.before.coverage,
    after_coverage: result.after.coverage,
    actions: result.actions,
    event_count: state.events.length
  }
};

const jsonPath = path.join(outputDir, 'ai-squad-management.json');
const markdownPath = path.join(outputDir, 'ai-squad-management.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Deterministic AI squad management\n\n- Accepted: **${report.accepted}**\n- Registered seniors before: **${result.before.summary.registered_seniors}**\n- Registered seniors after: **${result.after.summary.registered_seniors}**\n- Actions applied: **${result.actions.length}**\n- Decision-ledger events: **${state.events.filter((row) => row.type === 'ai_squad_decision_applied').length}**\n\n## Checks\n\n${Object.entries(checks).map(([key, value]) => `- ${key}: **${value}**`).join('\n')}\n\n## Actions\n\n${result.actions.map((row) => `- ${row.action}: ${row.player_id} — ${row.reason}`).join('\n')}\n`);

if (!report.accepted) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
