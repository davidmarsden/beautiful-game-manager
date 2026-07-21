import { createHash } from 'node:crypto';
import { syntheticSeasonClubs } from '../matchEngine/seasonSimulation.js';
import { playHumanManagerSeason } from '../matchEngine/humanManagerSeason.js';
import {
  createSquadCycleState,
  defaultSquadCycleCalendar,
  generateYouthIntake,
  processContractExpiries,
  renewContract,
  squadCycleSnapshot
} from '../squadCycle/squadCycle.js';
import { executeAiSquadPlan } from '../intelligence/aiSquadManagement.js';
import { analyseSquad } from '../intelligence/squadIntelligence.js';
import { appendSeasonArchive, createSeasonArchive } from '../history/seasonArchive.js';

const text = (value) => String(value ?? '').trim();
const DAY = 86400000;

export const PERSISTENT_WORLD_VERSION = 'tbg-playable-persistent-world-v1.0';
export const PERSISTENT_SAVE_VERSION = 'tbg-playable-world-save-v1.0';
export const PERSISTENT_LOOP_VERSION = 'tbg-persistent-season-loop-v1.0';

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function checksum(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function worldEvent(world, type, at, payload = {}) {
  const row = Object.freeze({
    event_id: `${world.world_id}:${String(world.event_ledger.length + 1).padStart(5, '0')}:${type}`,
    type,
    at: iso(at),
    season_id: world.squad_cycle.season_id,
    ...payload
  });
  world.event_ledger.push(row);
  return row;
}

function seasonId(world, number = world.season_number) {
  return `${world.world_id}:season-${number}`;
}

function clubProfiles(clubs) {
  return Object.fromEntries(clubs.map((club) => [club.club_id, {
    club_id: club.club_id,
    club_name: club.club_name,
    formation: club.formation,
    tactics: { ...(club.tactics || {}) }
  }]));
}

function registeredSeasonClubs(world) {
  return Object.keys(world.squad_cycle.clubs).sort().map((clubId) => {
    const cycleClub = world.squad_cycle.clubs[clubId];
    const profile = world.club_profiles[clubId];
    const players = cycleClub.registered_player_ids.map((playerId) => world.squad_cycle.players[playerId]).filter(Boolean);
    if (players.length < 18) throw new Error(`${clubId} cannot start ${world.squad_cycle.season_id}: only ${players.length} registered players`);
    return Object.freeze({
      ...profile,
      players: Object.freeze(players.map((player) => Object.freeze({ ...player })))
    });
  });
}

function activeContract(state, player) {
  return player?.contract_id ? state.contracts[player.contract_id] : null;
}

function applyHumanContinuityInstruction(world, at) {
  if (!world.human_offseason_instruction?.renew_expiring_registered) return [];
  const state = world.squad_cycle;
  const club = state.clubs[world.human_club_id];
  const renewed = [];
  for (const playerId of [...club.registered_player_ids].sort()) {
    const player = state.players[playerId];
    const contract = activeContract(state, player);
    if (!contract || contract.status !== 'active') continue;
    if (new Date(contract.end_at) > new Date(state.calendar.season_end)) continue;
    renewContract(state, {
      clubId: club.club_id,
      playerId,
      at,
      endAt: addYears(state.calendar.season_end, 2)
    });
    renewed.push(playerId);
    worldEvent(world, 'human_offseason_decision', at, {
      club_id: club.club_id,
      player_id: playerId,
      action: 'renew',
      reason: 'retain_registered_squad'
    });
  }
  return renewed;
}

function manageAiClubs(world, at) {
  const reports = [];
  for (const clubId of Object.keys(world.squad_cycle.clubs).sort()) {
    if (clubId === world.human_club_id) continue;
    reports.push(executeAiSquadPlan(world.squad_cycle, { clubId, at }));
  }
  return reports;
}

function viability(world, at) {
  return Object.keys(world.squad_cycle.clubs).sort().map((clubId) => {
    const report = analyseSquad(world.squad_cycle, { clubId, at });
    return Object.freeze({
      club_id: clubId,
      registered_seniors: report.summary.registered_seniors,
      hard_minimum_gap: report.summary.hard_minimum_gap,
      coverage_gaps: Object.freeze(report.coverage.filter((row) => row.registered_gap > 0).map((row) => Object.freeze({ group: row.group, gap: row.registered_gap }))),
      viable: report.summary.hard_minimum_gap === 0 && report.coverage.every((row) => row.registered_gap === 0)
    });
  });
}

function rolloverSquadCycle(world) {
  const nextNumber = world.season_number + 1;
  const nextStart = addYears(world.season_start, 1);
  const nextEnd = addYears(world.season_end, 1);
  const nextId = seasonId(world, nextNumber);
  world.season_number = nextNumber;
  world.season_start = nextStart;
  world.season_end = nextEnd;
  world.squad_cycle.season_id = nextId;
  world.squad_cycle.calendar = defaultSquadCycleCalendar({ seasonId: nextId, seasonStart: nextStart, seasonEnd: nextEnd });
  return world.squad_cycle.calendar;
}

export function validatePersistentWorld(world) {
  const errors = [];
  if (world?.version !== PERSISTENT_WORLD_VERSION) errors.push(`Unsupported world version: ${world?.version}`);
  if (!world?.world_id) errors.push('World ID is required');
  if (!world?.human_club_id || !world?.squad_cycle?.clubs?.[world.human_club_id]) errors.push('Human club must exist in the world');
  const state = world?.squad_cycle;
  if (!state) errors.push('Squad-cycle state is required');
  if (state) {
    for (const [clubId, club] of Object.entries(state.clubs || {})) {
      for (const playerId of club.player_ids || []) {
        if (!state.players[playerId]) errors.push(`${clubId} references unknown player ${playerId}`);
        else if (state.players[playerId].club_id !== clubId) errors.push(`${playerId} ownership disagrees with ${clubId}`);
      }
      for (const playerId of club.registered_player_ids || []) {
        if (!club.player_ids.includes(playerId)) errors.push(`${clubId} registers unowned player ${playerId}`);
      }
    }
    for (const player of Object.values(state.players || {})) {
      if (!player.club_id) continue;
      const contract = activeContract(state, player);
      if (!contract || contract.status !== 'active' || contract.club_id !== player.club_id) errors.push(`${player.tbg_player_id} lacks a matching active contract`);
    }
  }
  const archiveIds = (world?.history?.archives || []).map((row) => row.archive_id);
  if (new Set(archiveIds).size !== archiveIds.length) errors.push('History contains duplicate archives');
  const eventIds = (world?.event_ledger || []).map((row) => row.event_id);
  if (new Set(eventIds).size !== eventIds.length) errors.push('World event ledger contains duplicate IDs');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function savePersistentWorld(world) {
  const validation = validatePersistentWorld(world);
  if (!validation.valid) throw new Error(`Cannot save invalid world: ${validation.errors.join('; ')}`);
  const payload = clone(world);
  const envelope = {
    save_version: PERSISTENT_SAVE_VERSION,
    world_version: world.version,
    saved_at: world.clock,
    checksum: checksum(payload),
    world: payload
  };
  return canonicalJson(envelope);
}

export function loadPersistentWorld(serialized) {
  const envelope = typeof serialized === 'string' ? JSON.parse(serialized) : clone(serialized);
  if (envelope?.save_version !== PERSISTENT_SAVE_VERSION) throw new Error(`Unsupported save version: ${envelope?.save_version}`);
  if (checksum(envelope.world) !== envelope.checksum) throw new Error('Persistent-world checksum mismatch');
  const validation = validatePersistentWorld(envelope.world);
  if (!validation.valid) throw new Error(`Invalid persistent world: ${validation.errors.join('; ')}`);
  return envelope.world;
}

export function createPersistentWorld({
  worldId = 'tbg-world-1',
  clubs = syntheticSeasonClubs(),
  humanClubId = clubs[0]?.club_id,
  seasonStart = '2026-08-01T00:00:00.000Z',
  seasonEnd = '2027-06-30T23:59:59.000Z',
  registrationLimit = 25,
  humanOffseasonInstruction = { renew_expiring_registered: true }
} = {}) {
  const start = iso(seasonStart);
  const end = iso(seasonEnd);
  const initialSeasonId = `${worldId}:season-1`;
  const squadCycle = createSquadCycleState({ clubs, seasonId: initialSeasonId, seasonStart: start, seasonEnd: end, registrationLimit });
  const world = {
    version: PERSISTENT_WORLD_VERSION,
    world_id: text(worldId),
    phase: 'preseason',
    clock: squadCycle.calendar.transfer_windows[0].opens_at,
    season_number: 1,
    season_start: start,
    season_end: end,
    human_club_id: text(humanClubId),
    human_offseason_instruction: { ...humanOffseasonInstruction },
    club_profiles: clubProfiles(clubs),
    squad_cycle: squadCycle,
    history: { version: 'tbg-history-index-v1.0', archives: [] },
    completed_seasons: [],
    event_ledger: [],
    checkpoints: []
  };
  worldEvent(world, 'world_created', world.clock, { human_club_id: world.human_club_id, club_count: clubs.length });
  const validation = validatePersistentWorld(world);
  if (!validation.valid) throw new Error(`Could not create persistent world: ${validation.errors.join('; ')}`);
  return world;
}

export function checkpointPersistentWorld(world, label) {
  const saved = savePersistentWorld(world);
  const restored = loadPersistentWorld(saved);
  const row = Object.freeze({
    checkpoint_id: `${world.world_id}:${world.season_number}:${label}`,
    label,
    phase: world.phase,
    season_id: world.squad_cycle.season_id,
    checksum: JSON.parse(saved).checksum,
    equivalent: canonicalJson(world) === canonicalJson(restored)
  });
  world.checkpoints.push(row);
  return Object.freeze({ saved, restored, checkpoint: row });
}

export function advancePersistentSeason(worldInput, {
  defaultInstruction = {},
  instructionsByMatchday = {},
  daysBetweenRounds = 7
} = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  if (world.phase !== 'preseason') throw new Error(`World must be in preseason to advance: ${world.phase}`);
  const currentSeasonId = world.squad_cycle.season_id;
  const summerOpen = world.squad_cycle.calendar.transfer_windows[0].opens_at;
  world.clock = summerOpen;

  const humanRenewals = applyHumanContinuityInstruction(world, summerOpen);
  const aiPreseason = manageAiClubs(world, summerOpen);
  const beforeSeason = viability(world, summerOpen);
  if (!beforeSeason.every((row) => row.viable)) throw new Error(`Season cannot begin with invalid squads: ${JSON.stringify(beforeSeason.filter((row) => !row.viable))}`);

  world.phase = 'season';
  world.clock = world.season_start;
  const openingCheckpoint = checkpointPersistentWorld(world, 'season-opening');
  const clubs = registeredSeasonClubs(world);
  const seasonRun = playHumanManagerSeason({
    clubs,
    humanClubId: world.human_club_id,
    seasonId: currentSeasonId,
    startAt: world.season_start,
    daysBetweenRounds,
    defaultInstruction,
    instructionsByMatchday
  });
  if (!seasonRun.accepted || !seasonRun.season_report?.accepted) throw new Error(`Season simulation was not accepted: ${currentSeasonId}`);

  world.clock = world.season_end;
  const archive = createSeasonArchive(seasonRun.season_report, { archivedAt: world.clock });
  if (!archive.accepted) throw new Error(`Season archive was not accepted: ${currentSeasonId}`);
  world.history = appendSeasonArchive(world.history, archive);
  world.completed_seasons.push({
    season_id: currentSeasonId,
    human_final_standing: seasonRun.final_standing,
    archive_id: archive.archive_id,
    decision_count: seasonRun.decisions.length
  });
  worldEvent(world, 'season_archived', world.clock, { archive_id: archive.archive_id, champion_club_id: archive.summary.champion_club_id });

  world.phase = 'offseason';
  for (const clubId of Object.keys(world.squad_cycle.clubs).sort()) {
    const created = generateYouthIntake(world.squad_cycle, { clubId });
    worldEvent(world, 'club_youth_intake_completed', world.squad_cycle.calendar.youth_intake_at, { club_id: clubId, player_count: created.length });
  }
  const released = processContractExpiries(world.squad_cycle);
  worldEvent(world, 'contract_expiry_cycle_completed', world.clock, { released_player_ids: [...released] });
  const offseasonCheckpoint = checkpointPersistentWorld(world, 'offseason-after-expiry');

  const nextCalendar = rolloverSquadCycle(world);
  world.clock = nextCalendar.transfer_windows[0].opens_at;
  const aiNextPreseason = manageAiClubs(world, world.clock);
  const nextSeasonViability = viability(world, world.clock);
  if (!nextSeasonViability.every((row) => row.viable)) throw new Error(`Rollover produced invalid squads: ${JSON.stringify(nextSeasonViability.filter((row) => !row.viable))}`);
  world.phase = 'preseason';
  worldEvent(world, 'season_rollover_completed', world.clock, { from_season_id: currentSeasonId, to_season_id: world.squad_cycle.season_id });
  const finalSave = savePersistentWorld(world);
  const restored = loadPersistentWorld(finalSave);

  const checks = Object.freeze({
    opening_save_load_equivalent: openingCheckpoint.checkpoint.equivalent,
    offseason_save_load_equivalent: offseasonCheckpoint.checkpoint.equivalent,
    season_completed: seasonRun.accepted,
    archive_accepted: archive.accepted,
    archive_persisted_once: restored.history.archives.filter((row) => row.season_id === currentSeasonId).length === 1,
    human_decision_for_every_fixture: seasonRun.decisions.length === seasonRun.onboarding.required_decisions,
    all_ai_clubs_managed_before_season: aiPreseason.length === Object.keys(world.club_profiles).length - 1,
    all_ai_clubs_managed_after_rollover: aiNextPreseason.length === Object.keys(world.club_profiles).length - 1,
    next_season_squads_viable: nextSeasonViability.every((row) => row.viable),
    squad_cycle_integrity: squadCycleSnapshot(restored.squad_cycle).accepted,
    final_save_load_equivalent: canonicalJson(world) === canonicalJson(restored),
    event_ids_unique: new Set(restored.event_ledger.map((row) => row.event_id)).size === restored.event_ledger.length
  });

  return Object.freeze({
    version: PERSISTENT_LOOP_VERSION,
    season_id: currentSeasonId,
    next_season_id: restored.squad_cycle.season_id,
    human_club_id: restored.human_club_id,
    human_renewals: Object.freeze(humanRenewals),
    ai_preseason: Object.freeze(aiPreseason),
    season: seasonRun,
    archive,
    released_player_ids: Object.freeze([...released]),
    ai_next_preseason: Object.freeze(aiNextPreseason),
    next_season_viability: Object.freeze(nextSeasonViability),
    saved_world: finalSave,
    world: restored,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

export function runPersistentWorldSeasons({ seasons = 2, world, ...advanceOptions } = {}) {
  if (!Number.isInteger(seasons) || seasons < 1) throw new Error('Persistent-world season count must be a positive integer');
  let current = world || createPersistentWorld();
  const reports = [];
  for (let index = 0; index < seasons; index += 1) {
    const report = advancePersistentSeason(current, advanceOptions);
    reports.push(report);
    current = report.world;
  }
  const checks = Object.freeze({
    every_season_accepted: reports.every((row) => row.accepted),
    archives_are_unique: new Set(current.history.archives.map((row) => row.archive_id)).size === current.history.archives.length,
    archive_count_matches_seasons: current.history.archives.length === seasons,
    world_advanced_exactly: current.season_number === seasons + 1,
    final_world_valid: validatePersistentWorld(current).valid,
    final_squads_viable: viability(current, current.clock).every((row) => row.viable)
  });
  return Object.freeze({
    version: PERSISTENT_LOOP_VERSION,
    seasons,
    reports: Object.freeze(reports),
    final_world: current,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
