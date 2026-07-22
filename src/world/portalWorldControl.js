import {
  loadPersistentWorld,
  savePersistentWorld
} from './persistentSeasonLoop.js';
import {
  advancePersistentMatchday,
  validatePersistentMatchdayWorld
} from './persistentMatchdayWorld.js';
import {
  registerPlayer,
  renewContract,
  transferPlayer,
  unregisterPlayer,
  squadCycleSnapshot
} from '../squadCycle/squadCycle.js';
import { validatePlayerLifecycleWorld } from './playerLifecycleReconciliation.js';

export const PORTAL_WORLD_CONTROL_VERSION = 'tbg-portal-world-control-v1.0';

const text = (value) => String(value ?? '').trim();

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function safeCheckpoint(world) {
  if (world.phase === 'preseason' || world.phase === 'offseason') return true;
  if (world.phase !== 'season' || !world.matchday_cycle) return false;
  const cursors = Object.values(world.matchday_cycle.runtimes || {}).map((runtime) => runtime.next_matchday);
  return cursors.length === 5
    && new Set(cursors).size === 1
    && cursors[0] === world.matchday_cycle.current_matchday;
}

function controlledClub(world, clubId) {
  const requested = text(clubId || world.human_club_id);
  if (!requested || requested !== world.human_club_id) throw new Error('Portal may only control the appointed human club');
  const club = world.squad_cycle.clubs[requested];
  if (!club) throw new Error(`Unknown controlled club: ${requested}`);
  return club;
}

function activePlayer(world, playerId) {
  const player = world.squad_cycle.players[text(playerId)];
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  if (player.active_circulation === false || player.lifecycle_status === 'inactive' || player.lifecycle_status === 'retired') {
    throw new Error(`${player.tbg_player_id} is excluded from active circulation`);
  }
  return player;
}

function validateWorld(world) {
  const lifecycle = world.reality_sync
    ? validatePlayerLifecycleWorld(world)
    : validatePersistentMatchdayWorld(world);
  if (!lifecycle.valid) throw new Error(`Portal world is invalid: ${lifecycle.errors.join('; ')}`);
  const squad = squadCycleSnapshot(world.squad_cycle);
  if (!squad.accepted) throw new Error('Portal world squad cycle is invalid');
  return true;
}

function commandEvent(world, command, payload = {}) {
  const row = {
    event_id: `${world.world_id}:${String(world.event_ledger.length + 1).padStart(5, '0')}:portal_${command}`,
    type: `portal_${command}`,
    at: iso(world.clock),
    season_id: world.squad_cycle.season_id,
    manager_club_id: world.human_club_id,
    ...payload
  };
  world.event_ledger.push(row);
  return row;
}

function response(world, command, result = {}) {
  validateWorld(world);
  const savedWorld = savePersistentWorld(world);
  const restored = loadPersistentWorld(savedWorld);
  validateWorld(restored);
  return Object.freeze({
    version: PORTAL_WORLD_CONTROL_VERSION,
    command,
    result: Object.freeze(result),
    world: restored,
    saved_world: savedWorld,
    summary: portalWorldSummary(restored),
    accepted: true
  });
}

export function portalWorldSummary(world) {
  validateWorld(world);
  const club = controlledClub(world);
  const registration = club.registered_player_ids.length;
  const owned = club.player_ids.length;
  const currentMatchday = world.matchday_cycle?.current_matchday || null;
  const maximumMatchday = world.matchday_cycle?.maximum_matchday || null;
  const activeContracts = club.player_ids.filter((playerId) => {
    const player = world.squad_cycle.players[playerId];
    return world.squad_cycle.contracts[player?.contract_id]?.status === 'active';
  }).length;
  return Object.freeze({
    world_id: world.world_id,
    season_id: world.squad_cycle.season_id,
    season_number: world.season_number,
    phase: world.phase,
    clock: world.clock,
    human_club_id: world.human_club_id,
    owned_players: owned,
    registered_players: registration,
    active_contracts: activeContracts,
    current_matchday: currentMatchday,
    maximum_matchday: maximumMatchday,
    can_advance: world.phase === 'preseason' || world.phase === 'season',
    can_manage_squad: safeCheckpoint(world)
  });
}

export function loadPortalWorld(savedWorld) {
  const world = loadPersistentWorld(savedWorld);
  return response(world, 'load', { loaded: true });
}

export function savePortalWorld(worldInput) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  commandEvent(world, 'save', { phase: world.phase });
  return response(world, 'save', { saved: true });
}

export function advancePortalWorld(worldInput, { humanInstruction = {}, daysBetweenRounds = 7 } = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  controlledClub(world);
  const advanced = advancePersistentMatchday(world, { humanInstruction, daysBetweenRounds });
  commandEvent(advanced.world, 'advance', {
    matchday: advanced.matchday,
    season_completed: advanced.season_completed
  });
  return response(advanced.world, 'advance', {
    matchday: advanced.matchday,
    season_completed: advanced.season_completed,
    checkpoint_id: advanced.checkpoint.checkpoint_id
  });
}

export function registerPortalPlayer(worldInput, { playerId, register = true } = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  if (!safeCheckpoint(world)) throw new Error('Registration changes require a persistent checkpoint');
  const club = controlledClub(world);
  const player = activePlayer(world, playerId);
  if (player.club_id !== club.club_id) throw new Error(`${player.tbg_player_id} is not owned by ${club.club_id}`);
  if (register) {
    registerPlayer(world.squad_cycle, { clubId: club.club_id, playerId: player.tbg_player_id, at: world.clock });
  } else {
    unregisterPlayer(world.squad_cycle, { clubId: club.club_id, playerId: player.tbg_player_id, at: world.clock, reason: 'portal_manager_decision' });
  }
  commandEvent(world, register ? 'register_player' : 'unregister_player', { player_id: player.tbg_player_id });
  return response(world, register ? 'register_player' : 'unregister_player', {
    player_id: player.tbg_player_id,
    registered: Boolean(register)
  });
}

export function renewPortalContract(worldInput, { playerId, years = 2, wage } = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  if (!safeCheckpoint(world)) throw new Error('Contract changes require a persistent checkpoint');
  const club = controlledClub(world);
  const player = activePlayer(world, playerId);
  if (player.club_id !== club.club_id) throw new Error(`${player.tbg_player_id} is not owned by ${club.club_id}`);
  const safeYears = Number.isInteger(Number(years)) && Number(years) >= 1 && Number(years) <= 5 ? Number(years) : 2;
  const contract = renewContract(world.squad_cycle, {
    clubId: club.club_id,
    playerId: player.tbg_player_id,
    at: world.clock,
    endAt: addYears(world.squad_cycle.calendar.season_end, safeYears),
    wage
  });
  commandEvent(world, 'renew_contract', { player_id: player.tbg_player_id, contract_id: contract.contract_id });
  return response(world, 'renew_contract', {
    player_id: player.tbg_player_id,
    contract_id: contract.contract_id,
    end_at: contract.end_at,
    wage: contract.wage
  });
}

export function transferPortalPlayer(worldInput, {
  playerId,
  direction,
  otherClubId,
  fee = 0,
  contractYears = 3,
  wage
} = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  if (!safeCheckpoint(world)) throw new Error('Transfers require a persistent checkpoint');
  const humanClub = controlledClub(world);
  const player = activePlayer(world, playerId);
  const other = world.squad_cycle.clubs[text(otherClubId)];
  if (!other || other.club_id === humanClub.club_id) throw new Error('Transfer requires another valid club');
  const mode = text(direction).toLowerCase();
  const fromClubId = mode === 'buy' ? other.club_id : humanClub.club_id;
  const toClubId = mode === 'buy' ? humanClub.club_id : other.club_id;
  if (mode !== 'buy' && mode !== 'sell') throw new Error('Transfer direction must be buy or sell');
  if (player.club_id !== fromClubId) throw new Error(`${player.tbg_player_id} is not owned by ${fromClubId}`);
  const safeYears = Number.isInteger(Number(contractYears)) && Number(contractYears) >= 1 && Number(contractYears) <= 5 ? Number(contractYears) : 3;
  const transferred = transferPlayer(world.squad_cycle, {
    playerId: player.tbg_player_id,
    fromClubId,
    toClubId,
    at: world.clock,
    fee: Math.max(0, Number(fee) || 0),
    contractEndAt: addYears(world.clock, safeYears),
    wage
  });
  commandEvent(world, 'transfer_player', {
    player_id: player.tbg_player_id,
    direction: mode,
    from_club_id: fromClubId,
    to_club_id: toClubId,
    fee: Math.max(0, Number(fee) || 0)
  });
  return response(world, 'transfer_player', {
    player_id: transferred.tbg_player_id,
    direction: mode,
    from_club_id: fromClubId,
    to_club_id: toClubId
  });
}

export function executePortalWorldCommand(worldInput, command = {}) {
  const type = text(command.type).toLowerCase();
  if (type === 'save') return savePortalWorld(worldInput);
  if (type === 'advance') return advancePortalWorld(worldInput, command);
  if (type === 'register_player') return registerPortalPlayer(worldInput, { ...command, register: true });
  if (type === 'unregister_player') return registerPortalPlayer(worldInput, { ...command, register: false });
  if (type === 'renew_contract') return renewPortalContract(worldInput, command);
  if (type === 'transfer_player') return transferPortalPlayer(worldInput, command);
  throw new Error(`Unsupported portal world command: ${command.type}`);
}
