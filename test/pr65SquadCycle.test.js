import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTransferWindow,
  createSquadCycleState,
  generateYouthIntake,
  processContractExpiries,
  registerPlayer,
  renewContract,
  squadCycleSnapshot,
  transferPlayer
} from '../src/squadCycle/squadCycle.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

function foundationState(options = {}) {
  return createSquadCycleState({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'pr65-season',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    ...options
  });
}

function serialisableState(state) {
  return JSON.parse(JSON.stringify(state));
}

test('creates a registered contracted squad for every club', () => {
  const state = foundationState();
  const snapshot = squadCycleSnapshot(state);
  assert.equal(snapshot.accepted, true, JSON.stringify(snapshot.checks, null, 2));
  assert.equal(snapshot.clubs.length, 4);
  assert.ok(snapshot.clubs.every((club) => club.squad_size === 19 && club.registered_size === 19));
  assert.equal(snapshot.active_contract_count, 76);
});

test('transfer windows reject closed-date moves and accept open-window transfers', () => {
  const state = foundationState();
  const playerId = state.clubs['club-1'].player_ids[0];
  assert.equal(activeTransferWindow(state, '2026-07-15T12:00:00.000Z').name, 'summer');
  assert.throws(() => transferPlayer(state, {
    playerId,
    fromClubId: 'club-1',
    toClubId: 'club-2',
    at: '2026-10-01T12:00:00.000Z'
  }), /Transfer window is closed/);

  transferPlayer(state, {
    playerId,
    fromClubId: 'club-1',
    toClubId: 'club-2',
    at: '2026-07-15T12:00:00.000Z',
    fee: 5000000,
    wage: 25000,
    contractEndAt: '2030-06-30T23:59:59.000Z'
  });

  assert.equal(state.players[playerId].club_id, 'club-2');
  assert.equal(state.clubs['club-1'].player_ids.includes(playerId), false);
  assert.equal(state.clubs['club-2'].registered_player_ids.includes(playerId), true);
  assert.equal(state.contracts[state.players[playerId].contract_id].wage, 25000);
  assert.equal(squadCycleSnapshot(state).accepted, true);
});

test('a transfer rejected by destination capacity leaves all state unchanged', () => {
  const state = foundationState({ registrationLimit: 19 });
  const playerId = state.clubs['club-1'].player_ids[0];
  const before = serialisableState(state);

  assert.throws(() => transferPlayer(state, {
    playerId,
    fromClubId: 'club-1',
    toClubId: 'club-2',
    at: '2026-07-15T12:00:00.000Z',
    contractEndAt: '2030-06-30T23:59:59.000Z'
  }), /registration limit reached/);

  assert.deepEqual(serialisableState(state), before);
  assert.equal(state.players[playerId].club_id, 'club-1');
  assert.equal(squadCycleSnapshot(state).accepted, true);
});

test('registration enforces ownership, deadlines and squad limits', () => {
  const clubs = syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }).map((club, clubIndex) => ({
    ...club,
    players: club.players.map((player, playerIndex) => ({ ...player, registered: !(clubIndex === 0 && playerIndex === 18) }))
  }));
  const state = createSquadCycleState({
    clubs,
    seasonId: 'pr65-registration',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    registrationLimit: 19
  });
  const unregisteredId = state.clubs['club-1'].player_ids[18];
  registerPlayer(state, { clubId: 'club-1', playerId: unregisteredId, at: '2026-08-20T12:00:00.000Z' });
  assert.equal(state.registrations[unregisteredId].registered, true);
  assert.throws(() => registerPlayer(state, { clubId: 'club-2', playerId: unregisteredId, at: '2026-08-20T12:00:00.000Z' }), /not owned/);
  assert.throws(() => registerPlayer(state, { clubId: 'club-1', playerId: unregisteredId, at: '2027-07-10T12:00:00.000Z' }), /Registration is closed/);
});

test('contract renewal protects a player while unrenewed expiries create free agents', () => {
  const state = foundationState();
  const protectedId = state.clubs['club-1'].player_ids[0];
  const expiringId = state.clubs['club-1'].player_ids[1];
  renewContract(state, {
    playerId: protectedId,
    clubId: 'club-1',
    at: '2027-05-01T12:00:00.000Z',
    endAt: '2030-06-30T23:59:59.000Z',
    wage: 30000
  });
  const released = processContractExpiries(state, { at: '2027-06-30T23:59:59.000Z' });
  assert.equal(released.includes(protectedId), false);
  assert.equal(released.includes(expiringId), true);
  assert.equal(state.players[protectedId].club_id, 'club-1');
  assert.equal(state.players[expiringId].club_id, null);
  assert.equal(squadCycleSnapshot(state).accepted, true);
});

test('an invalid renewal leaves the active contract and entire state unchanged', () => {
  const state = foundationState();
  const playerId = state.clubs['club-1'].player_ids[0];
  const originalContractId = state.players[playerId].contract_id;
  const before = serialisableState(state);

  assert.throws(() => renewContract(state, {
    playerId,
    clubId: 'club-1',
    at: '2027-05-01T12:00:00.000Z',
    endAt: '2027-04-30T12:00:00.000Z',
    wage: 30000
  }), /Contract end must be after contract start/);

  assert.deepEqual(serialisableState(state), before);
  assert.equal(state.players[playerId].contract_id, originalContractId);
  assert.equal(state.contracts[originalContractId].status, 'active');
});

test('youth intake is deterministic and produces constitutional youth ratings', () => {
  const first = foundationState();
  const second = foundationState();
  const firstIntake = generateYouthIntake(first, { clubId: 'club-1' });
  const secondIntake = generateYouthIntake(second, { clubId: 'club-1' });
  assert.deepEqual(firstIntake, secondIntake);
  assert.equal(firstIntake.length, 3);
  assert.ok(firstIntake.every((player) => player.age >= 16 && player.age <= 18));
  assert.ok(firstIntake.every((player) => player.underlying_ability_rating >= 65 && player.underlying_ability_rating <= 70));
  assert.ok(firstIntake.every((player) => first.registrations[player.tbg_player_id].registered === false));
  assert.equal(squadCycleSnapshot(first).accepted, true);
});
