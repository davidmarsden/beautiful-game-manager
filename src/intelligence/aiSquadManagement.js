import { analyseSquad, DEFAULT_HARD_MINIMUM_SQUAD, DEFAULT_PREFERRED_MINIMUM_SQUAD } from './squadIntelligence.js';
import { activeTransferWindow, registerPlayer, renewContract } from '../squadCycle/squadCycle.js';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const AI_SQUAD_MANAGEMENT_VERSION = 'tbg-ai-squad-management-v1.1';

const GROUP_ORDER = Object.freeze(['goalkeeper', 'defender', 'midfielder', 'attacker']);

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

function event(state, type, at, payload = {}) {
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at: iso(at),
    ...payload
  });
  state.events.push(row);
  return row;
}

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

function rating(player) {
  return number(player?.underlying_ability_rating ?? player?.rating);
}

function positionGroupFromReport(report, id) {
  return report.players.find((row) => row.player_id === id)?.position_group || 'attacker';
}

function sortedPlayers(players) {
  return [...players].sort((a, b) => rating(b) - rating(a) || playerId(a).localeCompare(playerId(b)));
}

function freeAgents(state) {
  return sortedPlayers(Object.values(state.players).filter((player) => !player.club_id && number(player.age, 24) >= 19));
}

function addFreeAgentToClub(state, { clubId, playerId: idValue, at, contractYears = 3, wage } = {}) {
  const atIso = iso(at);
  const club = state.clubs[text(clubId)];
  const player = state.players[text(idValue)];
  if (!club) throw new Error(`Unknown club: ${clubId}`);
  if (!player) throw new Error(`Unknown player: ${idValue}`);
  if (player.club_id) throw new Error(`${playerId(player)} is not a free agent`);
  if (!activeTransferWindow(state, atIso)) throw new Error(`Transfer window is closed at ${atIso}`);
  if (club.registered_player_ids.length >= state.registration_limit) {
    throw new Error(`${club.club_id} registration limit reached`);
  }

  const contractId = `${playerId(player)}:${club.club_id}:${atIso}:free-agent`;
  if (state.contracts[contractId]) throw new Error(`Duplicate contract: ${contractId}`);

  player.club_id = club.club_id;
  club.player_ids.push(playerId(player));
  state.contracts[contractId] = {
    contract_id: contractId,
    player_id: playerId(player),
    club_id: club.club_id,
    start_at: atIso,
    end_at: addYears(atIso, contractYears),
    wage: Math.max(0, number(wage, 1000)),
    status: 'active'
  };
  player.contract_id = contractId;
  state.registrations[playerId(player)] = {
    player_id: playerId(player),
    club_id: club.club_id,
    registered: false,
    registered_at: null
  };
  event(state, 'free_agent_signed', atIso, {
    club_id: club.club_id,
    player_id: playerId(player),
    contract_id: contractId,
    end_at: state.contracts[contractId].end_at
  });
  registerPlayer(state, { clubId: club.club_id, playerId: playerId(player), at: atIso });
  return player;
}

function decision(action, clubId, playerIdValue, reason, details = {}) {
  return Object.freeze({ action, club_id: clubId, player_id: playerIdValue || null, reason, ...details });
}

export function planAiSquad(state, {
  clubId,
  at = state.calendar?.transfer_windows?.[0]?.opens_at || state.calendar?.season_start,
  hardMinimum = DEFAULT_HARD_MINIMUM_SQUAD,
  preferredMinimum = DEFAULT_PREFERRED_MINIMUM_SQUAD
} = {}) {
  const atIso = iso(at);
  const analysis = analyseSquad(state, { clubId, at: atIso, hardMinimum, preferredMinimum });
  const club = state.clubs[text(clubId)];
  if (!club) throw new Error(`Unknown club: ${clubId}`);

  const actions = [];
  const expiring = analysis.players
    .filter((row) => row.contract_horizon === 'expiring_this_season' && row.registered && row.squad_role !== 'surplus')
    .sort((a, b) => b.rating - a.rating || a.player_id.localeCompare(b.player_id));

  for (const row of expiring) {
    actions.push(decision('renew', club.club_id, row.player_id, `retain_${row.squad_role}`, {
      end_at: addYears(state.calendar.season_end, 2)
    }));
  }

  const unregisteredOwned = analysis.players
    .filter((row) => !row.registered && row.age >= 19)
    .sort((a, b) => b.rating - a.rating || a.player_id.localeCompare(b.player_id));

  let projectedRegistered = analysis.summary.registered_seniors;
  let projectedTotalRegistered = club.registered_player_ids.length;
  const projectedCoverage = Object.fromEntries(analysis.coverage.map((row) => [row.group, row.registered]));
  const hasRegistrationCapacity = () => projectedTotalRegistered < state.registration_limit;

  for (const group of GROUP_ORDER) {
    const requirement = analysis.coverage.find((row) => row.group === group)?.required || 0;
    while ((projectedCoverage[group] || 0) < requirement && hasRegistrationCapacity()) {
      const index = unregisteredOwned.findIndex((row) => row.position_group === group);
      if (index < 0) break;
      const [row] = unregisteredOwned.splice(index, 1);
      actions.push(decision('register', club.club_id, row.player_id, `repair_${group}_coverage`));
      projectedCoverage[group] += 1;
      projectedRegistered += 1;
      projectedTotalRegistered += 1;
    }
  }

  while (projectedRegistered < hardMinimum && unregisteredOwned.length && hasRegistrationCapacity()) {
    const row = unregisteredOwned.shift();
    actions.push(decision('register', club.club_id, row.player_id, 'repair_hard_minimum'));
    projectedCoverage[row.position_group] = (projectedCoverage[row.position_group] || 0) + 1;
    projectedRegistered += 1;
    projectedTotalRegistered += 1;
  }

  const prospects = analysis.players
    .filter((row) => !row.registered && row.age <= 18 && row.rating >= 68)
    .sort((a, b) => b.rating - a.rating || a.player_id.localeCompare(b.player_id));
  if (prospects.length && hasRegistrationCapacity()) {
    actions.push(decision('promote_youth', club.club_id, prospects[0].player_id, 'best_ready_prospect'));
    projectedTotalRegistered += 1;
  }

  const candidates = freeAgents(state).map((player) => ({
    player,
    group: positionGroupFromReport(analyseSquad({ ...state, clubs: { ...state.clubs, __free_agent_probe__: { club_id: '__free_agent_probe__', player_ids: [playerId(player)], registered_player_ids: [] } } }, { clubId: '__free_agent_probe__', at: atIso }), playerId(player))
  }));

  for (const group of GROUP_ORDER) {
    const requirement = analysis.coverage.find((row) => row.group === group)?.required || 0;
    while ((projectedCoverage[group] || 0) < requirement && hasRegistrationCapacity()) {
      const index = candidates.findIndex((row) => row.group === group);
      if (index < 0) break;
      const [{ player }] = candidates.splice(index, 1);
      actions.push(decision('sign_free_agent', club.club_id, playerId(player), `repair_${group}_coverage`));
      projectedCoverage[group] += 1;
      projectedRegistered += 1;
      projectedTotalRegistered += 1;
    }
  }

  while (projectedRegistered < preferredMinimum && candidates.length && hasRegistrationCapacity()) {
    const { player, group } = candidates.shift();
    actions.push(decision('sign_free_agent', club.club_id, playerId(player), projectedRegistered < hardMinimum ? 'repair_hard_minimum' : 'reach_preferred_range'));
    projectedCoverage[group] = (projectedCoverage[group] || 0) + 1;
    projectedRegistered += 1;
    projectedTotalRegistered += 1;
  }

  return Object.freeze({
    version: AI_SQUAD_MANAGEMENT_VERSION,
    club_id: club.club_id,
    at: atIso,
    before: analysis,
    actions: Object.freeze(actions),
    projected: Object.freeze({
      registered_seniors: projectedRegistered,
      total_registered: projectedTotalRegistered,
      registration_limit: state.registration_limit,
      coverage: Object.freeze(projectedCoverage)
    })
  });
}

export function executeAiSquadPlan(state, options = {}) {
  const plan = planAiSquad(state, options);
  const applied = [];

  for (const row of plan.actions) {
    if (row.action === 'renew') {
      renewContract(state, {
        clubId: row.club_id,
        playerId: row.player_id,
        at: plan.at,
        endAt: row.end_at
      });
    } else if (row.action === 'register') {
      registerPlayer(state, { clubId: row.club_id, playerId: row.player_id, at: plan.at });
    } else if (row.action === 'promote_youth') {
      const player = state.players[row.player_id];
      player.promoted_to_senior_at = plan.at;
      event(state, 'youth_promoted', plan.at, { club_id: row.club_id, player_id: row.player_id });
      registerPlayer(state, { clubId: row.club_id, playerId: row.player_id, at: plan.at });
    } else if (row.action === 'sign_free_agent') {
      addFreeAgentToClub(state, { clubId: row.club_id, playerId: row.player_id, at: plan.at });
    } else {
      throw new Error(`Unsupported AI squad action: ${row.action}`);
    }
    event(state, 'ai_squad_decision_applied', plan.at, row);
    applied.push(row);
  }

  const after = analyseSquad(state, {
    clubId: plan.club_id,
    at: plan.at,
    hardMinimum: options.hardMinimum,
    preferredMinimum: options.preferredMinimum
  });

  return Object.freeze({
    version: AI_SQUAD_MANAGEMENT_VERSION,
    club_id: plan.club_id,
    at: plan.at,
    before: plan.before,
    actions: Object.freeze(applied),
    after,
    accepted: after.summary.hard_minimum_gap === 0 && after.coverage.every((row) => row.registered_gap === 0)
  });
}

export function manageWorldSquads(state, options = {}) {
  const results = [];
  for (const clubId of Object.keys(state.clubs).sort()) {
    results.push(executeAiSquadPlan(state, { ...options, clubId }));
  }
  return Object.freeze(results);
}
