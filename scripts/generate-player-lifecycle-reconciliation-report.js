import fs from 'node:fs';
import path from 'node:path';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday } from '../src/world/persistentMatchdayWorld.js';
import {
  applyPlayerLifecycleReconciliation,
  PLAYER_LIFECYCLE_MANIFEST_VERSION,
  validatePlayerLifecycleWorld
} from '../src/world/playerLifecycleReconciliation.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
let world = createPersistentLeagueWorld({
  worldId: 'player-lifecycle-acceptance',
  divisions,
  humanClubId: divisions[0].clubs[0].club_id,
  movementCount: 1
});
world = advancePersistentMatchday(world).world;

const retiredPlayerId = world.squad_cycle.clubs['d1-club-2'].registered_player_ids[0];
const inactivePlayerId = world.squad_cycle.clubs['d2-club-1'].registered_player_ids[0];
const returningPlayerId = world.squad_cycle.clubs['d3-club-1'].registered_player_ids[0];
const returningContractId = world.squad_cycle.players[returningPlayerId].contract_id;

const first = applyPlayerLifecycleReconciliation(world, {
  version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
  source_snapshot_id: 'tm-acceptance-2026-08-09',
  effective_at: '2026-08-09T00:00:00.000Z',
  players: [
    { tbg_player_id: retiredPlayerId, new_status: 'RETIRED', source: 'transfermarkt', evidence_ref: 'tm:retired' },
    { tbg_player_id: inactivePlayerId, new_status: 'WITHOUT_CLUB_TOO_LONG', source: 'transfermarkt', evidence_ref: 'tm:without-club' },
    { tbg_player_id: returningPlayerId, new_status: 'RETIRED', source: 'transfermarkt', evidence_ref: 'tm:retired-before-return' }
  ]
});

const second = applyPlayerLifecycleReconciliation(first.world, {
  version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
  source_snapshot_id: 'tm-acceptance-2026-09-01',
  effective_at: '2026-09-01T00:00:00.000Z',
  players: [
    { tbg_player_id: returningPlayerId, new_status: 'ACTIVE', source: 'transfermarkt', evidence_ref: 'tm:return-from-retirement' }
  ]
});

const repeated = applyPlayerLifecycleReconciliation(second.world, {
  version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
  source_snapshot_id: 'tm-acceptance-2026-09-01',
  effective_at: '2026-09-01T00:00:00.000Z',
  players: [
    { tbg_player_id: returningPlayerId, new_status: 'ACTIVE', source: 'transfermarkt', evidence_ref: 'tm:return-from-retirement' }
  ]
});

const retired = second.world.squad_cycle.players[retiredPlayerId];
const inactive = second.world.squad_cycle.players[inactivePlayerId];
const returned = second.world.squad_cycle.players[returningPlayerId];
const validation = validatePlayerLifecycleWorld(second.world);

const checks = {
  retirement_snapshot_accepted: first.accepted,
  reactivation_snapshot_accepted: second.accepted,
  repeated_snapshot_is_idempotent: repeated.accepted && repeated.idempotent && !repeated.applied,
  retired_player_removed_from_circulation: retired.lifecycle_status === 'retired' && retired.active_circulation === false && retired.club_id === null,
  inactive_player_preserves_ownership_and_contract: inactive.lifecycle_status === 'inactive'
    && inactive.club_id === 'd2-club-1'
    && second.world.squad_cycle.contracts[inactive.contract_id]?.status === 'active',
  retired_player_can_return_as_free_agent: returned.lifecycle_status === 'active'
    && returned.active_circulation === true
    && returned.club_id === null
    && second.world.squad_cycle.contracts[returningContractId]?.status === 'terminated_reality_retirement',
  historical_player_records_preserved: Boolean(second.world.squad_cycle.players[retiredPlayerId]) && Boolean(second.world.squad_cycle.players[returningPlayerId]),
  reconciliation_ledger_complete: second.world.reality_sync.reconciliations.length === 4,
  world_valid_after_reality_sync: validation.valid,
  matchday_cursor_preserved: second.world.phase === 'season' && second.world.matchday_cycle.current_matchday === 2
};

const report = {
  version: 'tbg-player-lifecycle-reconciliation-report-v1.0',
  generated_at: new Date().toISOString(),
  accepted: Object.values(checks).every(Boolean),
  checks,
  summary: {
    source_snapshots_applied: second.world.reality_sync.applied_snapshot_ids.length,
    reconciliations_recorded: second.world.reality_sync.reconciliations.length,
    retired_players: Object.values(second.world.squad_cycle.players).filter((player) => player.lifecycle_status === 'retired').length,
    inactive_players: Object.values(second.world.squad_cycle.players).filter((player) => player.lifecycle_status === 'inactive').length,
    active_players: Object.values(second.world.squad_cycle.players).filter((player) => (player.lifecycle_status || 'active') === 'active').length,
    final_phase: second.world.phase,
    next_matchday: second.world.matchday_cycle.current_matchday
  },
  reconciliations: second.world.reality_sync.reconciliations
};

const jsonPath = path.join(outputDir, 'player-lifecycle-reconciliation.json');
const markdownPath = path.join(outputDir, 'player-lifecycle-reconciliation.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Player Lifecycle Reconciliation Acceptance\n\n- Accepted: **${report.accepted}**\n- Source snapshots: **${report.summary.source_snapshots_applied}**\n- Reconciliations: **${report.summary.reconciliations_recorded}**\n- Retired: **${report.summary.retired_players}**\n- Inactive: **${report.summary.inactive_players}**\n- Final phase: **${report.summary.final_phase}**\n- Next matchday: **${report.summary.next_matchday}**\n\n## Checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Player lifecycle reconciliation accepted: ${jsonPath}`);
}
