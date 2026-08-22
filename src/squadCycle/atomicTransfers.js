import {
  activeTransferWindow,
  registrationOpen,
  isYouthSquadPlayer,
  DEFAULT_FIRST_TEAM_SQUAD_LIMIT,
  DEFAULT_YOUTH_SQUAD_LIMIT
} from './squadCycle.js';

const text = (value) => String(value ?? '').trim();
const integer = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + Number(years || 0));
  return date.toISOString();
}

function cohort(player) {
  return isYouthSquadPlayer(player) ? 'youth' : 'first_team';
}

function limits(state) {
  return {
    first_team: Math.max(1, integer(state?.squad_limits?.first_team, DEFAULT_FIRST_TEAM_SQUAD_LIMIT)),
    youth: Math.max(1, integer(state?.squad_limits?.youth, DEFAULT_YOUTH_SQUAD_LIMIT))
  };
}

function pushEvent(state, type, at, payload = {}) {
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at,
    ...payload
  });
  state.events.push(row);
  return row;
}

function countCohort(state, club, cohortName, ids = club.player_ids) {
  return (ids || []).reduce((count, id) => {
    const player = state.players[id];
    return count + (player && cohort(player) === cohortName ? 1 : 0);
  }, 0);
}

function normalizePlayerLegs(state, legs, atIso) {
  if (!Array.isArray(legs) || legs.length === 0) throw new Error('Atomic exchange requires at least one player leg');
  const seen = new Set();
  return legs.map((raw, index) => {
    const playerId = text(raw?.player_id ?? raw?.playerId);
    const fromClubId = text(raw?.from_club_id ?? raw?.fromClubId);
    const toClubId = text(raw?.to_club_id ?? raw?.toClubId);
    const contractYears = Math.max(1, Math.min(5, integer(raw?.contract_years ?? raw?.contractYears, 3)));
    const fee = Math.max(0, integer(raw?.fee, 0));
    if (!playerId) throw new Error(`Atomic exchange player leg ${index + 1} requires a player`);
    if (seen.has(playerId)) throw new Error(`Atomic exchange contains duplicate player ${playerId}`);
    seen.add(playerId);
    const player = state.players?.[playerId];
    const from = state.clubs?.[fromClubId];
    const to = state.clubs?.[toClubId];
    if (!player) throw new Error(`Unknown player: ${playerId}`);
    if (!from) throw new Error(`Unknown club: ${fromClubId}`);
    if (!to) throw new Error(`Unknown club: ${toClubId}`);
    if (fromClubId === toClubId) throw new Error('Transfer requires two different clubs');
    if (player.club_id !== fromClubId || !from.player_ids.includes(playerId)) throw new Error(`${playerId} is not owned by ${fromClubId}`);
    if (to.player_ids.includes(playerId)) throw new Error(`${playerId} already belongs to ${toClubId}`);
    const contractEndAt = addYears(atIso, contractYears);
    if (new Date(contractEndAt) <= new Date(atIso)) throw new Error('Contract end must be after contract start');
    return { playerId, fromClubId, toClubId, contractYears, contractEndAt, fee, player, from, to, cohort: cohort(player) };
  });
}

function assertFinalCapacity(state, normalized) {
  const cap = limits(state);
  const affectedClubIds = new Set(normalized.flatMap((leg) => [leg.fromClubId, leg.toClubId]));
  for (const clubId of affectedClubIds) {
    const club = state.clubs[clubId];
    for (const cohortName of ['first_team', 'youth']) {
      const outbound = normalized.filter((leg) => leg.fromClubId === clubId && leg.cohort === cohortName).length;
      const inbound = normalized.filter((leg) => leg.toClubId === clubId && leg.cohort === cohortName).length;
      const finalSquad = countCohort(state, club, cohortName) - outbound + inbound;
      if (finalSquad > cap[cohortName]) {
        const label = cohortName === 'youth' ? 'youth' : 'first-team';
        throw new Error(`${clubId} ${label} squad limit reached (${cap[cohortName]})`);
      }

      const registeredOutbound = normalized.filter((leg) => {
        if (leg.fromClubId !== clubId || leg.cohort !== cohortName) return false;
        const registration = state.registrations?.[leg.playerId];
        return Boolean(registration?.registered && registration.club_id === clubId);
      }).length;
      const finalRegistered = countCohort(state, club, cohortName, club.registered_player_ids) - registeredOutbound + inbound;
      if (finalRegistered > cap[cohortName]) {
        const label = cohortName === 'youth' ? 'youth' : 'first-team';
        throw new Error(`${clubId} ${label} registration limit reached (${cap[cohortName]})`);
      }
    }
  }
}

/**
 * Apply every permanent-player leg against one squad-cycle state as a simultaneous exchange.
 * All ownership, transfer-window, registration-window and final split-squad capacities are
 * validated before the first mutation. This deliberately models the final post-deal state,
 * so a 25-player club can swap one player out and one player in without a transient 26th player.
 */
export function transferPlayersAtomically(state, { legs, at } = {}) {
  const atIso = iso(at);
  const window = activeTransferWindow(state, atIso);
  if (!window) throw new Error(`Transfer window is closed at ${atIso}`);
  if (!registrationOpen(state, atIso)) throw new Error(`Registration is closed at ${atIso}`);

  const normalized = normalizePlayerLegs(state, legs, atIso);
  assertFinalCapacity(state, normalized);

  // Phase 1: remove every outbound registration/roster slot. Because all validation above
  // used the final state, no receiving club is penalised by arbitrary leg ordering.
  for (const leg of normalized) {
    leg.from.registered_player_ids = leg.from.registered_player_ids.filter((id) => id !== leg.playerId);
    state.registrations[leg.playerId] = {
      player_id: leg.playerId,
      club_id: leg.fromClubId,
      registered: false,
      registered_at: state.registrations?.[leg.playerId]?.registered_at || null,
      unregistered_at: atIso,
      reason: 'transferred'
    };
    pushEvent(state, 'player_unregistered', atIso, { club_id: leg.fromClubId, player_id: leg.playerId, reason: 'transferred' });
    leg.from.player_ids = leg.from.player_ids.filter((id) => id !== leg.playerId);
  }

  // Phase 2: assign every inbound player, replacement contract and registration.
  for (const leg of normalized) {
    const oldContract = state.contracts?.[leg.player.contract_id];
    const nextContract = {
      contract_id: `${leg.playerId}:${leg.toClubId}:${atIso}`,
      player_id: leg.playerId,
      club_id: leg.toClubId,
      start_at: atIso,
      end_at: leg.contractEndAt,
      wage: Math.max(0, integer(oldContract?.wage, 1000)),
      status: 'active'
    };
    leg.to.player_ids.push(leg.playerId);
    leg.player.club_id = leg.toClubId;
    if (oldContract) {
      state.contracts[oldContract.contract_id] = Object.freeze({ ...oldContract, status: 'renewed' });
    }
    state.contracts[nextContract.contract_id] = nextContract;
    leg.player.contract_id = nextContract.contract_id;
    pushEvent(state, 'contract_renewed', atIso, {
      club_id: leg.toClubId,
      player_id: leg.playerId,
      contract_id: nextContract.contract_id,
      end_at: nextContract.end_at
    });
    state.registrations[leg.playerId] = {
      player_id: leg.playerId,
      club_id: leg.toClubId,
      registered: true,
      registered_at: atIso
    };
    if (!leg.to.registered_player_ids.includes(leg.playerId)) leg.to.registered_player_ids.push(leg.playerId);
    pushEvent(state, 'player_registered', atIso, { club_id: leg.toClubId, player_id: leg.playerId });
    pushEvent(state, 'player_transferred', atIso, {
      player_id: leg.playerId,
      from_club_id: leg.fromClubId,
      to_club_id: leg.toClubId,
      fee: leg.fee,
      window_id: window.window_id,
      atomic_exchange: normalized.length > 1
    });
  }

  return normalized.map((leg) => leg.playerId);
}
