import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import {
  advancePortalWorld,
  executePortalWorldCommand,
  loadPortalWorld,
  portalWorldSummary,
  registerPortalPlayer,
  renewPortalContract,
  savePortalWorld,
  transferPortalPlayer
} from '../src/world/portalWorldControl.js';
import { applyPlayerLifecycleReconciliation, PLAYER_LIFECYCLE_MANIFEST_VERSION } from '../src/world/playerLifecycleReconciliation.js';
import { PERSISTENT_SAVE_VERSION } from '../src/world/persistentSeasonLoop.js';
import { assertWorldMatchesAppointment, buildSavePayload } from '../netlify/functions/world-control.mjs';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr78-portal-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function identityRow(source = world()) {
  return {
    manager: { id: 'manager-pr78' },
    appointment: { world_id: source.world_id, club_id: source.human_club_id }
  };
}

test('portal save and load preserve a canonical persistent world', () => {
  const saved = savePortalWorld(world());
  const loaded = loadPortalWorld(saved.saved_world);
  assert.equal(saved.accepted, true);
  assert.equal(loaded.accepted, true);
  assert.deepEqual(loaded.world, saved.world);
  assert.equal(loaded.summary.phase, 'preseason');
});

test('Supabase payload uses the canonical envelope save_version', () => {
  const source = world();
  const saved = savePortalWorld(source);
  const envelope = JSON.parse(saved.saved_world);
  const payload = buildSavePayload(identityRow(source), saved, { updatedAt: '2026-07-22T12:00:00.000Z' });

  assert.equal(payload.save_version, envelope.save_version);
  assert.equal(payload.save_checksum, envelope.checksum);
  assert.equal(payload.save_version, PERSISTENT_SAVE_VERSION);
  assert.equal(payload.world_id, source.world_id);
  assert.equal(payload.updated_at, '2026-07-22T12:00:00.000Z');
});

test('portal save imports must match both the appointed world and club', () => {
  const source = world();
  const appointment = identityRow(source).appointment;
  assert.equal(assertWorldMatchesAppointment(source, appointment), true);
  assert.throws(
    () => assertWorldMatchesAppointment({ ...source, world_id: 'different-world' }, appointment, { label: 'Imported save' }),
    /active world appointment/
  );
  assert.throws(
    () => assertWorldMatchesAppointment({ ...source, human_club_id: 'd2-club-1' }, appointment, { label: 'Imported save' }),
    /active club appointment/
  );
});

test('portal advances exactly one persistent matchday', () => {
  const advanced = advancePortalWorld(world(), { humanInstruction: { formation: '4-2-3-1' } });
  assert.equal(advanced.accepted, true);
  assert.equal(advanced.result.matchday, 1);
  assert.equal(advanced.world.phase, 'season');
  assert.equal(advanced.summary.current_matchday, 2);
  assert.equal(advanced.world.matchday_cycle.checkpoints.length, 1);
});

test('portal controls registration and contract renewal for the human club only', () => {
  const source = world();
  const clubId = source.human_club_id;
  const playerId = source.squad_cycle.clubs[clubId].registered_player_ids[0];
  const unregistered = registerPortalPlayer(source, { playerId, register: false });
  assert.equal(unregistered.world.squad_cycle.registrations[playerId].registered, false);
  const registered = registerPortalPlayer(unregistered.world, { playerId, register: true });
  assert.equal(registered.world.squad_cycle.registrations[playerId].registered, true);
  const renewed = renewPortalContract(registered.world, { playerId, years: 3, wage: 2500 });
  assert.equal(renewed.accepted, true);
  assert.equal(renewed.result.wage, 2500);
  assert.equal(renewed.world.squad_cycle.contracts[renewed.result.contract_id].status, 'active');
});

test('portal can sell and buy players during the active window', () => {
  const source = world();
  const humanClubId = source.human_club_id;
  const otherClubId = Object.keys(source.squad_cycle.clubs).find((id) => id !== humanClubId);
  const soldPlayerId = source.squad_cycle.clubs[humanClubId].registered_player_ids[0];
  const sold = transferPortalPlayer(source, { playerId: soldPlayerId, direction: 'sell', otherClubId, fee: 1000000 });
  assert.equal(sold.world.squad_cycle.players[soldPlayerId].club_id, otherClubId);
  const targetId = sold.world.squad_cycle.clubs[otherClubId].registered_player_ids.find((id) => id !== soldPlayerId);
  const bought = transferPortalPlayer(sold.world, { playerId: targetId, direction: 'buy', otherClubId, fee: 750000 });
  assert.equal(bought.accepted, true);
  assert.equal(bought.world.squad_cycle.players[targetId].club_id, humanClubId);
});

test('portal blocks lifecycle-excluded players from manager actions', () => {
  const source = world();
  const clubId = source.human_club_id;
  const playerId = source.squad_cycle.clubs[clubId].registered_player_ids[0];
  const retired = applyPlayerLifecycleReconciliation(source, {
    version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
    source_snapshot_id: 'tm-pr78-retired',
    effective_at: source.clock,
    players: [{ tbg_player_id: playerId, new_status: 'RETIRED' }]
  });
  assert.throws(() => renewPortalContract(retired.world, { playerId }), /excluded from active circulation/);
});

test('generic portal command dispatcher exposes all supported controls', () => {
  const source = world();
  const summary = portalWorldSummary(source);
  assert.equal(summary.can_manage_squad, true);
  const saved = executePortalWorldCommand(source, { type: 'save' });
  assert.equal(saved.command, 'save');
  assert.throws(() => executePortalWorldCommand(source, { type: 'delete_world' }), /Unsupported portal world command/);
});
