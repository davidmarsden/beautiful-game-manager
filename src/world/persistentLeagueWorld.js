import { syntheticPlayableLeagueStructure } from '../matchEngine/leagueStructureSimulation.js';
import { simulateStatefulSeason } from '../matchEngine/seasonSimulation.js';
import { playHumanManagerSeason } from '../matchEngine/humanManagerSeason.js';
import { rollOverPlayableLeague } from '../matchEngine/seasonRollover.js';
import {
  createPersistentWorld,
  loadPersistentWorld,
  savePersistentWorld,
  validatePersistentWorld
} from './persistentSeasonLoop.js';
import {
  defaultSquadCycleCalendar,
  generateYouthIntake,
  processContractExpiries,
  renewContract,
  squadCycleSnapshot
} from '../squadCycle/squadCycle.js';
import { executeAiSquadPlan } from '../intelligence/aiSquadManagement.js';
import { analyseSquad } from '../intelligence/squadIntelligence.js';
import { appendSeasonArchive, createSeasonArchive } from '../history/seasonArchive.js';

export const PERSISTENT_LEAGUE_VERSION = 'tbg-persistent-published-division-world-v1.1';

const unique = (values) => new Set(values).size === values.length;
const divisionId = (level) => `d${level}`;

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

export function canonicalDivisionIds(divisionsOrCount) {
  const count = Array.isArray(divisionsOrCount) ? divisionsOrCount.length : Number(divisionsOrCount);
  if (!Number.isInteger(count) || count < 2) throw new Error('Persistent league requires at least two divisions');
  return Object.freeze(Array.from({ length: count }, (_, index) => divisionId(index + 1)));
}

function orderedDivisions(divisions) {
  if (!Array.isArray(divisions) || divisions.length < 2) throw new Error('Persistent league requires at least two divisions');
  const ordered = [...divisions].sort((a, b) => a.level - b.level);
  const ids = canonicalDivisionIds(ordered);
  ordered.forEach((division, index) => {
    if (division.level !== index + 1) throw new Error(`Persistent league divisions must be contiguous from level 1; found level ${division.level}`);
    if (division.division_id !== ids[index] && division.division_id !== `division-${index + 1}`) {
      throw new Error(`Invalid division identity ${division.division_id} for level ${index + 1}`);
    }
  });
  return ordered;
}

function divisionMembership(divisions) {
  return Object.freeze(orderedDivisions(divisions).map((division, index) => Object.freeze({
    division_id: divisionId(index + 1),
    level: index + 1,
    club_ids: Object.freeze(division.clubs.map((club) => club.club_id).sort())
  })));
}

function registeredClub(world, clubId) {
  const stateClub = world.squad_cycle.clubs[clubId];
  const profile = world.club_profiles[clubId];
  const players = stateClub.registered_player_ids.map((id) => world.squad_cycle.players[id]).filter(Boolean);
  if (players.length < 18) throw new Error(`${clubId} has only ${players.length} registered players`);
  return Object.freeze({ ...profile, players: Object.freeze(players.map((player) => Object.freeze({ ...player }))) });
}

function divisionSnapshots(world) {
  return world.competition.divisions.map((division) => Object.freeze({
    division_id: division.division_id,
    level: division.level,
    club_count: division.club_ids.length,
    clubs: Object.freeze(division.club_ids.map((clubId) => registeredClub(world, clubId)))
  }));
}

function validateCompetition(world) {
  const errors = [];
  const divisions = world?.competition?.divisions || [];
  if (world?.competition?.version !== PERSISTENT_LEAGUE_VERSION) errors.push('Unsupported persistent league version');
  if (divisions.length < 2) errors.push('Persistent league requires at least two divisions');
  const ids = divisions.map((row) => row.division_id);
  if (!unique(ids)) errors.push('Division IDs must be unique');
  for (const [index, division] of divisions.entries()) {
    if (division.division_id !== divisionId(index + 1) || division.level !== index + 1) {
      errors.push(`Invalid contiguous division at position ${index + 1}`);
    }
  }
  const clubIds = divisions.flatMap((row) => row.club_ids || []);
  if (!unique(clubIds)) errors.push('A club belongs to more than one division');
  const stateClubIds = Object.keys(world?.squad_cycle?.clubs || {}).sort();
  if (JSON.stringify([...clubIds].sort()) !== JSON.stringify(stateClubIds)) errors.push('Division membership does not match world clubs');
  return errors;
}

export function validatePersistentLeagueWorld(world) {
  const base = validatePersistentWorld(world);
  const errors = [...base.errors, ...validateCompetition(world)];
  const movementIds = (world?.competition?.movement_history || []).map((row) => row.movement_id);
  if (!unique(movementIds)) errors.push('Movement history contains duplicate IDs');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createPersistentLeagueWorld({
  worldId = 'tbg-published-division-world',
  divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 }),
  humanClubId = divisions[0]?.clubs[0]?.club_id,
  seasonStart,
  seasonEnd,
  movementCount = 1
} = {}) {
  const normalized = orderedDivisions(divisions).map((division, index) => ({ ...division, division_id: divisionId(index + 1), level: index + 1 }));
  const clubs = normalized.flatMap((division) => division.clubs);
  const world = createPersistentWorld({ worldId, clubs, humanClubId, seasonStart, seasonEnd });
  world.competition = {
    version: PERSISTENT_LEAGUE_VERSION,
    movement_count_per_boundary: movementCount,
    divisions: divisionMembership(normalized),
    movement_history: []
  };
  const validation = validatePersistentLeagueWorld(world);
  if (!validation.valid) throw new Error(`Invalid persistent league world: ${validation.errors.join('; ')}`);
  return world;
}

function renewHumanExpiries(world, at) {
  const state = world.squad_cycle;
  const club = state.clubs[world.human_club_id];
  for (const playerId of [...club.registered_player_ids].sort()) {
    const player = state.players[playerId];
    const contract = state.contracts[player.contract_id];
    if (contract?.status === 'active' && new Date(contract.end_at) <= new Date(state.calendar.season_end)) {
      renewContract(state, { clubId: club.club_id, playerId, at, endAt: addYears(state.calendar.season_end, 2) });
    }
  }
}

function manageAi(world, at) {
  return Object.keys(world.squad_cycle.clubs).sort()
    .filter((clubId) => clubId !== world.human_club_id)
    .map((clubId) => executeAiSquadPlan(world.squad_cycle, { clubId, at }));
}

function allViable(world, at) {
  return Object.keys(world.squad_cycle.clubs).every((clubId) => {
    const report = analyseSquad(world.squad_cycle, { clubId, at });
    return report.summary.hard_minimum_gap === 0 && report.coverage.every((row) => row.registered_gap === 0);
  });
}

function simulateDivisions(world, options) {
  const currentSeasonId = world.squad_cycle.season_id;
  const reports = [];
  let humanRun = null;
  for (const division of divisionSnapshots(world)) {
    const divisionSeasonId = `${currentSeasonId}:${division.division_id}`;
    if (division.clubs.some((club) => club.club_id === world.human_club_id)) {
      humanRun = playHumanManagerSeason({
        clubs: division.clubs,
        humanClubId: world.human_club_id,
        seasonId: divisionSeasonId,
        startAt: world.season_start,
        daysBetweenRounds: options.daysBetweenRounds,
        defaultInstruction: options.defaultInstruction,
        instructionsByMatchday: options.instructionsByMatchday
      });
      reports.push(Object.freeze({ division_id: division.division_id, level: division.level, ...humanRun.season_report }));
    } else {
      reports.push(Object.freeze({ division_id: division.division_id, level: division.level, ...simulateStatefulSeason({
        clubs: division.clubs,
        seasonId: divisionSeasonId,
        startAt: world.season_start,
        daysBetweenRounds: options.daysBetweenRounds
      }) }));
    }
  }
  const accepted = reports.every((row) => row.accepted) && Boolean(humanRun?.accepted);
  return Object.freeze({
    version: 'tbg-persistent-published-division-season-v1.1',
    season_id: currentSeasonId,
    divisions: Object.freeze(reports),
    human_run: humanRun,
    accepted
  });
}

function archiveDivisions(world, seasonReport) {
  const archives = [];
  for (const division of seasonReport.divisions) {
    const archive = createSeasonArchive(division, { archivedAt: world.season_end });
    if (!archive.accepted) throw new Error(`Archive rejected for ${division.division_id}`);
    world.history = appendSeasonArchive(world.history, archive);
    archives.push(archive);
  }
  return archives;
}

function rollCalendar(world) {
  world.season_number += 1;
  world.season_start = addYears(world.season_start, 1);
  world.season_end = addYears(world.season_end, 1);
  world.squad_cycle.season_id = `${world.world_id}:season-${world.season_number}`;
  world.squad_cycle.calendar = defaultSquadCycleCalendar({
    seasonId: world.squad_cycle.season_id,
    seasonStart: world.season_start,
    seasonEnd: world.season_end
  });
}

export function advancePersistentLeagueSeason(worldInput, {
  defaultInstruction = {},
  instructionsByMatchday = {},
  daysBetweenRounds = 7
} = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const validation = validatePersistentLeagueWorld(world);
  if (!validation.valid) throw new Error(`Invalid persistent league world: ${validation.errors.join('; ')}`);
  if (world.phase !== 'preseason') throw new Error(`World must be in preseason: ${world.phase}`);

  const completedSeasonId = world.squad_cycle.season_id;
  const summerOpen = world.squad_cycle.calendar.transfer_windows[0].opens_at;
  renewHumanExpiries(world, summerOpen);
  const aiBefore = manageAi(world, summerOpen);
  if (!allViable(world, summerOpen)) throw new Error('A club is not viable before the season');

  world.phase = 'season';
  const season = simulateDivisions(world, { defaultInstruction, instructionsByMatchday, daysBetweenRounds });
  if (!season.accepted) throw new Error(`Persistent league season rejected: ${completedSeasonId}`);
  const archives = archiveDivisions(world, season);

  const rollover = rollOverPlayableLeague({
    divisions: divisionSnapshots(world),
    completedReport: season,
    movementCount: world.competition.movement_count_per_boundary,
    nextSeasonId: `${world.world_id}:season-${world.season_number + 1}`
  });
  if (!rollover.accepted) throw new Error('Persistent league rollover rejected');
  const movementRows = rollover.movements.map((row, index) => Object.freeze({
    movement_id: `${completedSeasonId}:movement-${String(index + 1).padStart(2, '0')}`,
    season_id: completedSeasonId,
    ...row
  }));
  world.competition.movement_history.push(...movementRows);
  world.competition.divisions = divisionMembership(rollover.divisions);
  world.completed_seasons.push({
    season_id: completedSeasonId,
    division_archive_ids: archives.map((row) => row.archive_id),
    movement_ids: movementRows.map((row) => row.movement_id),
    human_final_standing: season.human_run.final_standing
  });

  world.phase = 'offseason';
  for (const clubId of Object.keys(world.squad_cycle.clubs).sort()) generateYouthIntake(world.squad_cycle, { clubId });
  const released = processContractExpiries(world.squad_cycle);
  rollCalendar(world);
  world.clock = world.squad_cycle.calendar.transfer_windows[0].opens_at;
  const aiAfter = manageAi(world, world.clock);
  if (!allViable(world, world.clock)) throw new Error('A club is not viable after rollover');
  world.phase = 'preseason';

  const saved = savePersistentWorld(world);
  const restored = loadPersistentWorld(saved);
  const finalValidation = validatePersistentLeagueWorld(restored);
  const clubIds = restored.competition.divisions.flatMap((row) => row.club_ids);
  const divisionCount = restored.competition.divisions.length;
  const expectedMovements = world.competition.movement_count_per_boundary * 2 * (divisionCount - 1);
  const checks = Object.freeze({
    season_completed: season.accepted,
    division_archives_created: archives.length === divisionCount,
    movement_count_correct: movementRows.length === expectedMovements,
    contiguous_divisions_preserved: restored.competition.divisions.every((division, index) => division.division_id === divisionId(index + 1) && division.level === index + 1),
    every_club_preserved_once: unique(clubIds) && clubIds.length === Object.keys(restored.squad_cycle.clubs).length,
    movement_history_persisted: restored.competition.movement_history.filter((row) => row.season_id === completedSeasonId).length === movementRows.length,
    human_decisions_complete: season.human_run.decisions.length === season.human_run.onboarding.required_decisions,
    all_ai_clubs_managed_before: aiBefore.length === clubIds.length - 1,
    all_ai_clubs_managed_after: aiAfter.length === clubIds.length - 1,
    next_squads_viable: allViable(restored, restored.clock),
    squad_cycle_integrity: squadCycleSnapshot(restored.squad_cycle).accepted,
    save_load_valid: finalValidation.valid
  });

  return Object.freeze({
    version: PERSISTENT_LEAGUE_VERSION,
    completed_season_id: completedSeasonId,
    next_season_id: restored.squad_cycle.season_id,
    season,
    archives: Object.freeze(archives),
    rollover,
    movements: Object.freeze(movementRows),
    released_player_ids: Object.freeze([...released]),
    world: restored,
    saved_world: saved,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

export function runPersistentLeagueSeasons({ seasons = 2, world, ...options } = {}) {
  if (!Number.isInteger(seasons) || seasons < 1) throw new Error('Season count must be positive');
  let current = world || createPersistentLeagueWorld();
  const startingArchiveCount = current.history?.archives?.length || 0;
  const startingMovementCount = current.competition?.movement_history?.length || 0;
  const startingSeasonNumber = current.season_number;
  const divisionCount = current.competition.divisions.length;
  const reports = [];
  for (let index = 0; index < seasons; index += 1) {
    const report = advancePersistentLeagueSeason(current, options);
    reports.push(report);
    current = report.world;
  }
  const expectedMovementsPerSeason = current.competition.movement_count_per_boundary * 2 * (divisionCount - 1);
  const checks = Object.freeze({
    every_season_accepted: reports.every((row) => row.accepted),
    archives_match_divisions_and_seasons: current.history.archives.length - startingArchiveCount === seasons * divisionCount,
    movements_match_boundaries_and_seasons: current.competition.movement_history.length - startingMovementCount === seasons * expectedMovementsPerSeason,
    world_advanced_exactly: current.season_number - startingSeasonNumber === seasons,
    final_world_valid: validatePersistentLeagueWorld(current).valid,
    division_membership_unique: unique(current.competition.divisions.flatMap((row) => row.club_ids)),
    final_world_returns_to_preseason: current.phase === 'preseason'
  });
  return Object.freeze({ version: PERSISTENT_LEAGUE_VERSION, seasons, reports: Object.freeze(reports), final_world: current, checks, accepted: Object.values(checks).every(Boolean) });
}
