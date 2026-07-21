import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday } from '../src/world/persistentMatchdayWorld.js';
import {
  applyPlayerLifecycleReconciliation,
  PLAYER_LIFECYCLE_MANIFEST_VERSION,
  validatePlayerLifecycleWorld
} from '../src/world/playerLifecycleReconciliation.js';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr77-lifecycle-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function manifest(snapshotId, players, effectiveAt = '2026-08-08T18:00:00.000Z') {
  return {
    version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
    source_snapshot_id: snapshotId,
    effective_at: effectiveAt,
    players
  };
}

test('confirmed retirement terminates contract, clears ownership and preserves the player record', () => {
  const source = world();
  const playerId = source.squad_cycle.clubs['d1-club-1'].registered_player_ids[0];
  const contractId = source.squad_cycle.players[playerId].contract_id;
  const result = applyPlayerLifecycleReconciliation(source, manifest('tm-retirement-1', [{
    tbg_player_id: playerId,
    new_status: 'RETIRED',
    source: 'transfermarkt',
    evidence_ref: 'tm:retired'
  }]));

  const player = result.world.squad_cycle.players[playerId];
  assert.equal(result.accepted, true);
  assert.equal(player.lifecycle_status, 'retired');
  assert.equal(player.active_circulation, false);
  assert.equal(player.club_id, null);
  assert.equal(result.world.squad_cycle.contracts[contractId].status, 'terminated_reality_retirement');
  assert.equal(result.world.squad_cycle.registrations[playerId].registered, false);
  assert.ok(result.world.squad_cycle.players[playerId]);
  assert.equal(result.world.event_ledger.some((row) => row.type === 'player_retired_from_reality' && row.player_id === playerId), true);
});

test('without-club-too-long inactivates but does not terminate an owned contract', () => {
  const source = world();
  const playerId = source.squad_cycle.clubs['d2-club-1'].registered_player_ids[0];
  const contractId = source.squad_cycle.players[playerId].contract_id;
  const result = applyPlayerLifecycleReconciliation(source, manifest('tm-inactive-1', [{
    tbg_player_id: playerId,
    new_status: 'WITHOUT_CLUB_TOO_LONG'
  }]));

  assert.equal(result.accepted, true);
  assert.equal(result.world.squad_cycle.players[playerId].lifecycle_status, 'inactive');
  assert.equal(result.world.squad_cycle.players[playerId].club_id, 'd2-club-1');
  assert.equal(result.world.squad_cycle.contracts[contractId].status, 'active');
  assert.equal(result.world.squad_cycle.registrations[playerId].registered, false);
});

test('a retired player who changes their mind returns as a free agent without recreating the old contract', () => {
  const source = world();
  const playerId = source.squad_cycle.clubs['d3-club-1'].registered_player_ids[0];
  const contractId = source.squad_cycle.players[playerId].contract_id;
  const retired = applyPlayerLifecycleReconciliation(source, manifest('tm-retirement-2', [{
    tbg_player_id: playerId,
    new_status: 'RETIRED'
  }]));
  const returned = applyPlayerLifecycleReconciliation(retired.world, manifest('tm-return-1', [{
    tbg_player_id: playerId,
    new_status: 'ACTIVE',
    evidence_ref: 'tm:return-from-retirement'
  }], '2026-09-01T12:00:00.000Z'));

  const player = returned.world.squad_cycle.players[playerId];
  assert.equal(returned.accepted, true);
  assert.equal(player.lifecycle_status, 'active');
  assert.equal(player.active_circulation, true);
  assert.equal(player.club_id, null);
  assert.equal(returned.world.squad_cycle.contracts[contractId].status, 'terminated_reality_retirement');
  assert.equal(returned.reconciliations[0].returned_as_free_agent, true);
  assert.equal(returned.world.event_ledger.some((row) => row.type === 'player_reactivated_from_reality' && row.player_id === playerId), true);
});

test('an inactive owned player can be reactivated without losing the existing contract', () => {
  const source = world();
  const playerId = source.squad_cycle.clubs['d4-club-1'].registered_player_ids[0];
  const contractId = source.squad_cycle.players[playerId].contract_id;
  const inactive = applyPlayerLifecycleReconciliation(source, manifest('tm-inactive-2', [{
    tbg_player_id: playerId,
    new_status: 'UNDER_REVIEW'
  }]));
  const active = applyPlayerLifecycleReconciliation(inactive.world, manifest('tm-cleared-1', [{
    tbg_player_id: playerId,
    new_status: 'ACTIVE'
  }], '2026-08-15T12:00:00.000Z'));

  assert.equal(active.accepted, true);
  assert.equal(active.world.squad_cycle.players[playerId].club_id, 'd4-club-1');
  assert.equal(active.world.squad_cycle.contracts[contractId].status, 'active');
  assert.equal(active.world.squad_cycle.registrations[playerId].registered, false);
  assert.equal(active.reconciliations[0].returned_as_free_agent, false);
});

test('the same source snapshot is idempotent', () => {
  const source = world();
  const playerId = source.squad_cycle.clubs['d5-club-1'].registered_player_ids[0];
  const update = manifest('tm-idempotent-1', [{ tbg_player_id: playerId, new_status: 'RETIRED' }]);
  const first = applyPlayerLifecycleReconciliation(source, update);
  const second = applyPlayerLifecycleReconciliation(first.world, update);

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.world.reality_sync.reconciliations.length, 1);
  assert.equal(second.world.event_ledger.filter((row) => row.type === 'player_retired_from_reality').length, 1);
});

test('reconciliation applies safely between persisted matchdays', () => {
  const afterMatchday = advancePersistentMatchday(world()).world;
  const playerId = afterMatchday.squad_cycle.clubs['d2-club-2'].registered_player_ids[0];
  const result = applyPlayerLifecycleReconciliation(afterMatchday, manifest('tm-between-md', [{
    tbg_player_id: playerId,
    new_status: 'RETIRED'
  }], '2026-08-09T00:00:00.000Z'));

  assert.equal(result.accepted, true);
  assert.equal(result.world.phase, 'season');
  assert.equal(result.world.matchday_cycle.current_matchday, 2);
  assert.equal(validatePlayerLifecycleWorld(result.world).valid, true);
});

test('rejects unknown players and duplicate manifest identities', () => {
  assert.throws(() => applyPlayerLifecycleReconciliation(world(), manifest('tm-unknown', [{
    tbg_player_id: 'not-in-world',
    new_status: 'RETIRED'
  }])), /unknown player/);
  const playerId = world().squad_cycle.clubs['d1-club-1'].registered_player_ids[0];
  assert.throws(() => applyPlayerLifecycleReconciliation(world(), manifest('tm-duplicate', [
    { tbg_player_id: playerId, new_status: 'ACTIVE' },
    { tbg_player_id: playerId, new_status: 'RETIRED' }
  ])), /present and unique/);
});
