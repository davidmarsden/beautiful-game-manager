import { analyseSquad, positionGroup } from '../intelligence/squadIntelligence.js';
import { registerPlayer, unregisterPlayer } from '../squadCycle/squadCycle.js';
import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';

export const VIABLE_CANONICAL_REGISTRATION_VERSION = 'tbg-viable-canonical-registration-v1.1';
export const CANONICAL_POSITION_REQUIREMENTS = Object.freeze({
  goalkeeper: 2,
  defender: 6,
  midfielder: 5,
  attacker: 3
});

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const playerId = (player) => text(player?.tbg_player_id || player?.player_id || player?.id);
const playerPosition = (player) => text(
  player?.position
  || player?.primary_position
  || player?.position_group
  || player?.position_name
  || player?.canonical_position
  || player?.position_detail
  || player?.transfermarkt_position
  || player?.specific_position
);
const rating = (player) => number(player?.underlying_ability_rating ?? player?.rating ?? player?.overall_rating);
const playerName = (player) => text(player?.display_name || player?.canonical_name || player?.name || playerId(player));

function ranked(players) {
  return players
    .map((player, sourceIndex) => ({ player, sourceIndex, id: playerId(player), group: positionGroup(playerPosition(player)), rating: rating(player) }))
    .filter((row) => row.id)
    .sort((a, b) => b.rating - a.rating || a.sourceIndex - b.sourceIndex || a.id.localeCompare(b.id));
}

export function selectViableRegistrationIds(players, registrationLimit = 25, requirements = CANONICAL_POSITION_REQUIREMENTS) {
  const rows = ranked(players).filter((row) => number(row.player.age, 24) >= 19);
  const selected = [];
  const selectedIds = new Set();
  const missing = {};

  for (const [group, required] of Object.entries(requirements)) {
    const candidates = rows.filter((row) => row.group === group && !selectedIds.has(row.id));
    const chosen = candidates.slice(0, required);
    chosen.forEach((row) => { selected.push(row); selectedIds.add(row.id); });
    missing[group] = Math.max(0, required - chosen.length);
  }

  const reservedForMissingCoverage = Object.values(missing).reduce((sum, gap) => sum + gap, 0);
  const ownedTarget = Math.max(0, registrationLimit - reservedForMissingCoverage);
  for (const row of rows) {
    if (selected.length >= ownedTarget) break;
    if (!selectedIds.has(row.id)) { selected.push(row); selectedIds.add(row.id); }
  }

  return Object.freeze({
    selected_ids: Object.freeze(selected.map((row) => row.id)),
    missing: Object.freeze(missing),
    reserved_free_agent_places: reservedForMissingCoverage
  });
}

function appendEvent(state, type, at, payload) {
  state.events ||= [];
  state.events.push({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at: new Date(at).toISOString(),
    ...payload
  });
}

function signFreeAgent(state, { clubId, playerId: id, at }) {
  const club = state.clubs[clubId];
  const player = state.players[id];
  if (!club || !player || player.club_id) throw new Error(`Free-agent signing is not available: ${id}`);
  if (club.registered_player_ids.length >= state.registration_limit) throw new Error(`${clubId} registration limit reached`);
  const atIso = new Date(at).toISOString();
  const contractId = `${id}:${clubId}:${atIso}:registration-repair`;
  player.club_id = clubId;
  club.player_ids.push(id);
  state.contracts[contractId] = {
    contract_id: contractId,
    player_id: id,
    club_id: clubId,
    start_at: atIso,
    end_at: state.calendar.season_end,
    wage: 1000,
    status: 'active'
  };
  player.contract_id = contractId;
  state.registrations[id] = { player_id: id, club_id: clubId, registered: false, registered_at: null };
  appendEvent(state, 'free_agent_signed', atIso, { club_id: clubId, player_id: id, contract_id: contractId, reason: 'canonical_registration_repair' });
  registerPlayer(state, { clubId, playerId: id, at: atIso });
  return player;
}

function actionPlayer(state, id) {
  const player = state.players[id];
  return { player_id: id, player_name: playerName(player), position_group: positionGroup(playerPosition(player)), rating: rating(player) };
}

export function planCanonicalRegistrationRepair(worldInput, { at } = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const state = world.squad_cycle;
  const repairAt = at || state.calendar?.transfer_windows?.[0]?.opens_at || world.clock;
  const registrationLimit = state.registration_limit;
  const clubs = [];

  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    const owned = club.player_ids.map((id) => state.players[id]).filter(Boolean);
    const selection = selectViableRegistrationIds(owned, registrationLimit);
    const desired = new Set(selection.selected_ids);
    const current = new Set(club.registered_player_ids);
    const removed = [...current].filter((id) => !desired.has(id)).map((id) => actionPlayer(state, id));
    const added = [...desired].filter((id) => !current.has(id)).map((id) => actionPlayer(state, id));

    for (const row of removed) unregisterPlayer(state, { clubId, playerId: row.player_id, at: repairAt, reason: 'canonical_registration_rebalance' });
    for (const row of added) registerPlayer(state, { clubId, playerId: row.player_id, at: repairAt });

    clubs.push({
      club_id: clubId,
      club_name: text(world.club_profiles?.[clubId]?.club_name || club.club_name || clubId),
      registrations_added: added,
      registrations_removed: removed,
      free_agents_signed: [],
      initial_missing: selection.missing
    });
  }

  const freeAgents = ranked(Object.values(state.players).filter((player) => !player.club_id && number(player.age, 24) >= 19));
  const usedFreeAgents = new Set();
  const nextFreeAgent = (group = null) => freeAgents.find((entry) => !usedFreeAgents.has(entry.id) && (!group || entry.group === group));

  for (const row of clubs) {
    const club = state.clubs[row.club_id];
    let report = analyseSquad(state, { clubId: row.club_id, at: repairAt });
    for (const gap of report.coverage.filter((entry) => entry.registered_gap > 0)) {
      for (let count = 0; count < gap.registered_gap; count += 1) {
        const candidate = nextFreeAgent(gap.group);
        if (!candidate || club.registered_player_ids.length >= registrationLimit) break;
        usedFreeAgents.add(candidate.id);
        signFreeAgent(state, { clubId: row.club_id, playerId: candidate.id, at: repairAt });
        row.free_agents_signed.push(actionPlayer(state, candidate.id));
      }
    }

    report = analyseSquad(state, { clubId: row.club_id, at: repairAt });
    while (report.summary.hard_minimum_gap > 0 && club.registered_player_ids.length < registrationLimit) {
      const candidate = nextFreeAgent();
      if (!candidate) break;
      usedFreeAgents.add(candidate.id);
      signFreeAgent(state, { clubId: row.club_id, playerId: candidate.id, at: repairAt });
      row.free_agents_signed.push(actionPlayer(state, candidate.id));
      report = analyseSquad(state, { clubId: row.club_id, at: repairAt });
    }

    report = analyseSquad(state, { clubId: row.club_id, at: repairAt });
    row.final_registered = report.summary.registered_seniors;
    row.final_coverage = report.coverage.map((entry) => ({ group: entry.group, registered: entry.registered, required: entry.required, gap: entry.registered_gap }));
    row.viable = report.viable;
  }

  const blocked = clubs.filter((row) => !row.viable).map((row) => ({
    club_id: row.club_id,
    club_name: row.club_name,
    registered_seniors: row.final_registered,
    coverage_gaps: row.final_coverage.filter((entry) => entry.gap > 0)
  }));

  const preview = Object.freeze({
    version: VIABLE_CANONICAL_REGISTRATION_VERSION,
    repair_at: new Date(repairAt).toISOString(),
    registration_limit: registrationLimit,
    registrations_added: clubs.reduce((sum, row) => sum + row.registrations_added.length, 0),
    registrations_removed: clubs.reduce((sum, row) => sum + row.registrations_removed.length, 0),
    free_agents_signed: clubs.reduce((sum, row) => sum + row.free_agents_signed.length, 0),
    clubs_still_impossible: blocked.length,
    clubs: Object.freeze(clubs),
    blocked: Object.freeze(blocked),
    accepted: blocked.length === 0
  });

  return Object.freeze({ world, preview });
}
