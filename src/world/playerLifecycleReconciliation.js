import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';
import { validatePersistentMatchdayWorld } from './persistentMatchdayWorld.js';
import { squadCycleSnapshot, unregisterPlayer } from '../squadCycle/squadCycle.js';

export const PLAYER_LIFECYCLE_MANIFEST_VERSION = 'tbg-player-lifecycle-manifest-v1.0';
export const PLAYER_LIFECYCLE_RECONCILIATION_VERSION = 'tbg-player-lifecycle-reconciliation-v1.0';

export const PLAYER_LIFECYCLE_STATUS = Object.freeze({
  active: 'active',
  inactive: 'inactive',
  retired: 'retired'
});

export const REALITY_STATUS = Object.freeze({
  active: 'ACTIVE',
  retired: 'RETIRED',
  withoutClubTooLong: 'WITHOUT_CLUB_TOO_LONG',
  underReview: 'UNDER_REVIEW',
  invalidRecord: 'INVALID_TRANSFERMARKT_RECORD',
  duplicate: 'DUPLICATE',
  staffNotPlayer: 'STAFF_NOT_PLAYER'
});

const INACTIVE_CODES = new Set([
  REALITY_STATUS.withoutClubTooLong,
  REALITY_STATUS.underReview,
  REALITY_STATUS.invalidRecord,
  REALITY_STATUS.duplicate,
  REALITY_STATUS.staffNotPlayer
]);

const text = (value) => String(value ?? '').trim();
const unique = (values) => new Set(values).size === values.length;

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function event(world, type, at, payload = {}) {
  const row = {
    event_id: `${world.world_id}:${String(world.event_ledger.length + 1).padStart(5, '0')}:${type}`,
    type,
    at: iso(at),
    season_id: world.squad_cycle.season_id,
    ...payload
  };
  world.event_ledger.push(row);
  return row;
}

function ensureLifecycleState(world) {
  world.reality_sync ||= {
    version: PLAYER_LIFECYCLE_RECONCILIATION_VERSION,
    applied_snapshot_ids: [],
    reconciliations: []
  };
  for (const player of Object.values(world.squad_cycle.players)) {
    player.lifecycle_status ||= PLAYER_LIFECYCLE_STATUS.active;
    if (player.active_circulation === undefined) player.active_circulation = true;
    if (player.lifecycle_reason === undefined) player.lifecycle_reason = null;
    if (player.lifecycle_effective_at === undefined) player.lifecycle_effective_at = null;
    if (player.lifecycle_source_snapshot_id === undefined) player.lifecycle_source_snapshot_id = null;
  }
}

function validateManifest(manifest) {
  if (manifest?.version !== PLAYER_LIFECYCLE_MANIFEST_VERSION) throw new Error('Unsupported player lifecycle manifest version');
  const snapshotId = text(manifest.source_snapshot_id);
  if (!snapshotId) throw new Error('Lifecycle manifest requires source_snapshot_id');
  const effectiveAt = iso(manifest.effective_at);
  if (!Array.isArray(manifest.players)) throw new Error('Lifecycle manifest requires players array');
  const ids = manifest.players.map((row) => text(row.tbg_player_id));
  if (ids.some((id) => !id) || !unique(ids)) throw new Error('Lifecycle manifest player IDs must be present and unique');
  for (const row of manifest.players) {
    const status = text(row.new_status).toUpperCase();
    if (status !== REALITY_STATUS.active && status !== REALITY_STATUS.retired && !INACTIVE_CODES.has(status)) {
      throw new Error(`Unsupported real-world lifecycle status: ${status}`);
    }
  }
  return { snapshotId, effectiveAt };
}

function safeCheckpoint(world) {
  if (world.phase === 'preseason' || world.phase === 'offseason') return true;
  if (world.phase !== 'season' || !world.matchday_cycle) return false;
  const nextValues = Object.values(world.matchday_cycle.runtimes || {}).map((runtime) => runtime.next_matchday);
  return nextValues.length === 5
    && new Set(nextValues).size === 1
    && nextValues[0] === world.matchday_cycle.current_matchday;
}

function terminateForRetirement(world, player, at) {
  const state = world.squad_cycle;
  const formerClubId = player.club_id || null;
  const contract = player.contract_id ? state.contracts[player.contract_id] : null;
  if (formerClubId && state.clubs[formerClubId]) {
    unregisterPlayer(state, {
      clubId: formerClubId,
      playerId: player.tbg_player_id,
      at,
      reason: 'real_world_retirement'
    });
    state.clubs[formerClubId].player_ids = state.clubs[formerClubId].player_ids.filter((id) => id !== player.tbg_player_id);
  }
  if (contract?.status === 'active') {
    contract.status = 'terminated_reality_retirement';
    contract.ended_at = at;
    contract.end_reason = 'REAL_WORLD_RETIREMENT';
  }
  player.club_id = null;
  return { formerClubId, contractId: contract?.contract_id || null };
}

function deactivatePlayer(world, player, at, reason) {
  const state = world.squad_cycle;
  const ownerId = player.club_id || null;
  if (ownerId && state.clubs[ownerId] && state.registrations[player.tbg_player_id]?.registered) {
    unregisterPlayer(state, {
      clubId: ownerId,
      playerId: player.tbg_player_id,
      at,
      reason: `reality_sync_${reason.toLowerCase()}`
    });
  } else if (state.registrations[player.tbg_player_id]) {
    state.registrations[player.tbg_player_id].registered = false;
    state.registrations[player.tbg_player_id].unregistered_at = at;
    state.registrations[player.tbg_player_id].reason = `reality_sync_${reason.toLowerCase()}`;
  }
  return { formerClubId: ownerId, contractId: player.contract_id || null };
}

function reactivatePlayer(world, player) {
  const contract = player.contract_id ? world.squad_cycle.contracts[player.contract_id] : null;
  const ownsActiveContract = Boolean(player.club_id && contract?.status === 'active');
  return {
    formerClubId: player.club_id || null,
    contractId: contract?.contract_id || null,
    returnedAsFreeAgent: !ownsActiveContract
  };
}

function applyRow(world, row, snapshotId, effectiveAt) {
  const playerId = text(row.tbg_player_id);
  const player = world.squad_cycle.players[playerId];
  if (!player) throw new Error(`Lifecycle manifest references unknown player: ${playerId}`);
  const status = text(row.new_status).toUpperCase();
  const previousStatus = player.lifecycle_status || PLAYER_LIFECYCLE_STATUS.active;
  let targetStatus;
  let action;
  let consequence;

  if (status === REALITY_STATUS.retired) {
    targetStatus = PLAYER_LIFECYCLE_STATUS.retired;
    action = previousStatus === PLAYER_LIFECYCLE_STATUS.retired ? 'unchanged' : 'retired';
    consequence = action === 'unchanged'
      ? { formerClubId: player.club_id || null, contractId: player.contract_id || null }
      : terminateForRetirement(world, player, effectiveAt);
  } else if (status === REALITY_STATUS.active) {
    targetStatus = PLAYER_LIFECYCLE_STATUS.active;
    action = previousStatus === PLAYER_LIFECYCLE_STATUS.active ? 'unchanged' : 'reactivated';
    consequence = reactivatePlayer(world, player);
  } else {
    targetStatus = PLAYER_LIFECYCLE_STATUS.inactive;
    action = previousStatus === PLAYER_LIFECYCLE_STATUS.inactive ? 'unchanged' : 'inactivated';
    consequence = action === 'unchanged'
      ? { formerClubId: player.club_id || null, contractId: player.contract_id || null }
      : deactivatePlayer(world, player, effectiveAt, status);
  }

  player.lifecycle_status = targetStatus;
  player.active_circulation = targetStatus === PLAYER_LIFECYCLE_STATUS.active;
  player.lifecycle_reason = status;
  player.lifecycle_effective_at = effectiveAt;
  player.lifecycle_source_snapshot_id = snapshotId;

  const reconciliation = {
    reconciliation_id: `${snapshotId}:${playerId}`,
    player_id: playerId,
    source_snapshot_id: snapshotId,
    source: text(row.source || 'transfermarkt'),
    evidence_ref: text(row.evidence_ref) || null,
    previous_world_status: previousStatus,
    new_world_status: targetStatus,
    reality_status: status,
    action,
    former_club_id: consequence.formerClubId || null,
    contract_id: consequence.contractId || null,
    returned_as_free_agent: Boolean(consequence.returnedAsFreeAgent),
    effective_at: effectiveAt,
    applied_at: effectiveAt
  };

  if (action !== 'unchanged') {
    const type = action === 'retired'
      ? 'player_retired_from_reality'
      : action === 'reactivated'
        ? 'player_reactivated_from_reality'
        : 'player_inactivated_from_reality';
    event(world, type, effectiveAt, {
      player_id: playerId,
      reality_status: status,
      former_club_id: consequence.formerClubId || null,
      contract_id: consequence.contractId || null
    });
  }
  return reconciliation;
}

export function validatePlayerLifecycleWorld(world) {
  const base = validatePersistentMatchdayWorld(world);
  const errors = [...base.errors];
  const state = world?.squad_cycle;
  if (!state) return Object.freeze({ valid: false, errors: Object.freeze([...errors, 'Missing squad cycle']) });
  const reconciliations = world?.reality_sync?.reconciliations || [];
  const reconciliationIds = reconciliations.map((row) => row.reconciliation_id);
  if (!unique(reconciliationIds)) errors.push('Lifecycle reconciliation IDs must be unique');
  const snapshotIds = world?.reality_sync?.applied_snapshot_ids || [];
  if (!unique(snapshotIds)) errors.push('Applied lifecycle snapshot IDs must be unique');

  for (const player of Object.values(state.players)) {
    const status = player.lifecycle_status || PLAYER_LIFECYCLE_STATUS.active;
    const registration = state.registrations[player.tbg_player_id];
    const contract = player.contract_id ? state.contracts[player.contract_id] : null;
    if (status === PLAYER_LIFECYCLE_STATUS.retired) {
      if (player.club_id) errors.push(`Retired player remains owned: ${player.tbg_player_id}`);
      if (registration?.registered) errors.push(`Retired player remains registered: ${player.tbg_player_id}`);
      if (contract?.status === 'active') errors.push(`Retired player retains active contract: ${player.tbg_player_id}`);
      if (player.active_circulation !== false) errors.push(`Retired player remains in active circulation: ${player.tbg_player_id}`);
    }
    if (status === PLAYER_LIFECYCLE_STATUS.inactive) {
      if (registration?.registered) errors.push(`Inactive player remains registered: ${player.tbg_player_id}`);
      if (player.active_circulation !== false) errors.push(`Inactive player remains in active circulation: ${player.tbg_player_id}`);
    }
    if (status === PLAYER_LIFECYCLE_STATUS.active && player.active_circulation === false) {
      errors.push(`Active player excluded from circulation: ${player.tbg_player_id}`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function applyPlayerLifecycleReconciliation(worldInput, manifest) {
  const { snapshotId, effectiveAt } = validateManifest(manifest);
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  ensureLifecycleState(world);
  if (!safeCheckpoint(world)) throw new Error(`Lifecycle reconciliation requires a safe checkpoint: ${world.phase}`);

  if (world.reality_sync.applied_snapshot_ids.includes(snapshotId)) {
    return Object.freeze({
      version: PLAYER_LIFECYCLE_RECONCILIATION_VERSION,
      source_snapshot_id: snapshotId,
      applied: false,
      idempotent: true,
      reconciliations: Object.freeze([]),
      world,
      saved_world: savePersistentWorld(world),
      checks: Object.freeze({ snapshot_applied_once: true, world_valid: validatePlayerLifecycleWorld(world).valid }),
      accepted: validatePlayerLifecycleWorld(world).valid
    });
  }

  const reconciliations = manifest.players.map((row) => applyRow(world, row, snapshotId, effectiveAt));
  world.reality_sync.reconciliations.push(...reconciliations);
  world.reality_sync.applied_snapshot_ids.push(snapshotId);
  world.reality_sync.last_applied_snapshot_id = snapshotId;
  world.reality_sync.last_applied_at = effectiveAt;
  event(world, 'player_lifecycle_snapshot_applied', effectiveAt, {
    source_snapshot_id: snapshotId,
    player_count: reconciliations.length
  });

  const validation = validatePlayerLifecycleWorld(world);
  const squad = squadCycleSnapshot(world.squad_cycle);
  const checks = Object.freeze({
    snapshot_applied_once: world.reality_sync.applied_snapshot_ids.filter((id) => id === snapshotId).length === 1,
    reconciliation_ids_unique: unique(world.reality_sync.reconciliations.map((row) => row.reconciliation_id)),
    every_row_recorded: reconciliations.length === manifest.players.length,
    squad_cycle_integrity: squad.accepted,
    world_valid: validation.valid
  });
  const saved = savePersistentWorld(world);
  const restored = loadPersistentWorld(saved);
  return Object.freeze({
    version: PLAYER_LIFECYCLE_RECONCILIATION_VERSION,
    source_snapshot_id: snapshotId,
    applied: true,
    idempotent: false,
    reconciliations: Object.freeze(reconciliations),
    world: restored,
    saved_world: saved,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
