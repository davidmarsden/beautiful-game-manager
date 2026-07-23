import { rollOverPlayableLeague } from '../matchEngine/seasonRollover.js';
import {
  advanceIncrementalMatchday,
  createIncrementalSeason,
  incrementalSeasonReport
} from '../matchEngine/incrementalSeasonSimulation.js';
import {
  loadPersistentWorld,
  savePersistentWorld
} from './persistentSeasonLoop.js';
import {
  validatePersistentLeagueWorld
} from './persistentLeagueWorld.js';
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

export const PERSISTENT_MATCHDAY_VERSION = 'tbg-persistent-matchday-world-v1.0';

const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (values) => new Set(values).size === values.length;

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function event(world, type, payload = {}) {
  const row = {
    event_id: `${world.world_id}:${String(world.event_ledger.length + 1).padStart(5, '0')}:${type}`,
    type,
    at: world.clock,
    season_id: world.squad_cycle.season_id,
    ...payload
  };
  world.event_ledger.push(row);
  return row;
}

function registeredClub(world, clubId) {
  const club = world.squad_cycle.clubs[clubId];
  const profile = world.club_profiles[clubId];
  const players = club.registered_player_ids.map((id) => world.squad_cycle.players[id]).filter(Boolean);
  if (players.length < 18) throw new Error(`${clubId} has only ${players.length} registered players`);
  return { ...profile, players: players.map((player) => ({ ...player })) };
}

function divisionClubs(world, division) {
  return division.club_ids.map((clubId) => registeredClub(world, clubId));
}

function allViable(world, at) {
  return Object.keys(world.squad_cycle.clubs).every((clubId) => {
    const report = analyseSquad(world.squad_cycle, { clubId, at });
    return report.summary.hard_minimum_gap === 0 && report.coverage.every((row) => row.registered_gap === 0);
  });
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

function divisionMembership(divisions) {
  return [...divisions]
    .sort((a, b) => a.level - b.level)
    .map((division, index) => ({
      division_id: division.division_id,
      level: index + 1,
      club_ids: division.clubs.map((club) => club.club_id).sort()
    }));
}

function divisionSnapshots(world) {
  return world.competition.divisions.map((division) => ({
    division_id: division.division_id,
    level: division.level,
    club_count: division.club_ids.length,
    clubs: divisionClubs(world, division)
  }));
}

export function validatePersistentMatchdayWorld(world) {
  const base = validatePersistentLeagueWorld(world);
  const errors = [...base.errors];
  const completed = world?.matchday_history || [];
  const completedIds = completed.flatMap((season) => (season.checkpoints || []).map((row) => row.checkpoint_id));
  if (!unique(completedIds)) errors.push('Completed matchday history contains duplicate checkpoint IDs');
  if (world?.matchday_cycle) {
    const activeIds = (world.matchday_cycle.checkpoints || []).map((row) => row.checkpoint_id);
    if (!unique(activeIds)) errors.push('Completed matchday history contains duplicate checkpoint IDs');
    if (activeIds.some((id) => completedIds.includes(id))) errors.push('Active checkpoint already exists in completed history');
    const runtimeIds = Object.keys(world.matchday_cycle.runtimes || {}).sort();
    const divisionIds = (world.competition?.divisions || []).map((division) => division.division_id).sort();
    if (JSON.stringify(runtimeIds) !== JSON.stringify(divisionIds)) errors.push('Matchday runtimes do not match world divisions');
    const processed = Object.values(world.matchday_cycle.runtimes || {}).map((runtime) => runtime.next_matchday);
    if (processed.some((next) => next !== world.matchday_cycle.current_matchday)) errors.push('Division matchday cursors disagree');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function initializeSeasonCycle(world, { daysBetweenRounds = 7 } = {}) {
  if (world.matchday_cycle) throw new Error(`Matchday cycle already active: ${world.matchday_cycle.season_id}`);
  const summerOpen = world.squad_cycle.calendar.transfer_windows[0].opens_at;
  world.clock = summerOpen;
  renewHumanExpiries(world, summerOpen);
  const aiPreseason = manageAi(world, summerOpen);
  if (!allViable(world, summerOpen)) throw new Error('A club is not viable before matchday advancement');

  const runtimes = {};
  let maximumMatchday = 0;
  for (const division of world.competition.divisions) {
    const clubs = divisionClubs(world, division);
    const humanClubId = division.club_ids.includes(world.human_club_id) ? world.human_club_id : null;
    const runtime = createIncrementalSeason({
      clubs,
      seasonId: `${world.squad_cycle.season_id}:${division.division_id}`,
      startAt: world.season_start,
      daysBetweenRounds,
      humanClubId
    });
    runtimes[division.division_id] = runtime;
    maximumMatchday = Math.max(maximumMatchday, ...runtime.fixtures.map((fixture) => fixture.matchday));
  }
  world.phase = 'season';
  world.clock = world.season_start;
  world.matchday_history ||= [];
  world.matchday_cycle = {
    version: PERSISTENT_MATCHDAY_VERSION,
    season_id: world.squad_cycle.season_id,
    current_matchday: 1,
    maximum_matchday: maximumMatchday,
    days_between_rounds: daysBetweenRounds,
    ai_preseason_count: aiPreseason.length,
    runtimes,
    checkpoints: []
  };
  event(world, 'matchday_cycle_started', { maximum_matchday: maximumMatchday });
  return world.matchday_cycle;
}

function completeSeason(world) {
  const cycle = world.matchday_cycle;
  const divisionReports = world.competition.divisions.map((division) => {
    const clubs = divisionClubs(world, division);
    return { division_id: division.division_id, level: division.level, ...incrementalSeasonReport(cycle.runtimes[division.division_id], { clubs }) };
  });
  const seasonReport = {
    version: PERSISTENT_MATCHDAY_VERSION,
    season_id: cycle.season_id,
    divisions: divisionReports,
    accepted: divisionReports.every((row) => row.accepted)
  };
  if (!seasonReport.accepted) throw new Error(`Incremental season rejected: ${cycle.season_id}`);

  world.clock = world.season_end;
  const archives = [];
  for (const report of divisionReports) {
    const archive = createSeasonArchive(report, { archivedAt: world.clock });
    if (!archive.accepted) throw new Error(`Incremental archive rejected: ${report.division_id}`);
    world.history = appendSeasonArchive(world.history, archive);
    archives.push(archive);
  }

  const rollover = rollOverPlayableLeague({
    divisions: divisionSnapshots(world),
    completedReport: seasonReport,
    movementCount: world.competition.movement_count_per_boundary,
    nextSeasonId: `${world.world_id}:season-${world.season_number + 1}`
  });
  if (!rollover.accepted) throw new Error('Incremental promotion/relegation rollover rejected');
  const movements = rollover.movements.map((row, index) => ({
    movement_id: `${cycle.season_id}:movement-${String(index + 1).padStart(2, '0')}`,
    season_id: cycle.season_id,
    ...row
  }));
  world.competition.movement_history.push(...movements);
  world.competition.divisions = divisionMembership(rollover.divisions);

  const humanRuntime = Object.values(cycle.runtimes).find((runtime) => runtime.human_club_id === world.human_club_id);
  const humanReport = divisionReports.find((report) => report.season_id === humanRuntime?.season_id);
  world.completed_seasons.push({
    season_id: cycle.season_id,
    division_archive_ids: archives.map((row) => row.archive_id),
    movement_ids: movements.map((row) => row.movement_id),
    human_final_standing: humanReport?.standings.find((row) => row.club_id === world.human_club_id) || null
  });
  world.matchday_history.push({
    season_id: cycle.season_id,
    checkpoints: cycle.checkpoints.map((row) => ({ ...row }))
  });

  world.phase = 'offseason';
  for (const clubId of Object.keys(world.squad_cycle.clubs).sort()) generateYouthIntake(world.squad_cycle, { clubId });
  const released = processContractExpiries(world.squad_cycle);
  world.season_number += 1;
  world.season_start = addYears(world.season_start, 1);
  world.season_end = addYears(world.season_end, 1);
  world.squad_cycle.season_id = `${world.world_id}:season-${world.season_number}`;
  world.squad_cycle.calendar = defaultSquadCycleCalendar({
    seasonId: world.squad_cycle.season_id,
    seasonStart: world.season_start,
    seasonEnd: world.season_end
  });
  world.clock = world.squad_cycle.calendar.transfer_windows[0].opens_at;
  const aiAfter = manageAi(world, world.clock);
  if (!allViable(world, world.clock)) throw new Error('A club is not viable after incremental rollover');
  world.phase = 'preseason';
  delete world.matchday_cycle;
  event(world, 'matchday_season_completed', {
    completed_season_id: cycle.season_id,
    archive_count: archives.length,
    movement_count: movements.length
  });
  return { archives, movements, rollover, released, aiAfter };
}

export function advancePersistentMatchday(worldInput, {
  humanInstruction = {},
  daysBetweenRounds = 7
} = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const validation = validatePersistentMatchdayWorld(world);
  if (!validation.valid) throw new Error(`Invalid persistent matchday world: ${validation.errors.join('; ')}`);
  if (world.phase === 'preseason') initializeSeasonCycle(world, { daysBetweenRounds });
  if (world.phase !== 'season' || !world.matchday_cycle) throw new Error(`World is not ready for matchday advancement: ${world.phase}`);

  const cycle = world.matchday_cycle;
  const matchday = cycle.current_matchday;
  const resultRows = [];
  for (const division of world.competition.divisions) {
    const runtime = cycle.runtimes[division.division_id];
    const clubs = divisionClubs(world, division);
    resultRows.push({
      division_id: division.division_id,
      ...advanceIncrementalMatchday(runtime, {
        clubs,
        humanInstruction: runtime.human_club_id ? humanInstruction : {}
      })
    });
  }

  const firstDivisionId = world.competition.divisions[0].division_id;
  const kickoff = cycle.runtimes[firstDivisionId].fixtures.find((fixture) => fixture.matchday === matchday)?.kickoff_at;
  world.clock = kickoff || world.clock;
  cycle.current_matchday += 1;
  const allComplete = Object.values(cycle.runtimes).every((runtime) => runtime.completed);
  const checkpoint = {
    checkpoint_id: `${cycle.season_id}:matchday-${matchday}`,
    season_id: cycle.season_id,
    matchday,
    fixture_count: resultRows.reduce((sum, row) => sum + row.fixtures_processed, 0),
    completed: allComplete
  };
  cycle.checkpoints.push(checkpoint);
  event(world, 'matchday_completed', { matchday, fixture_count: checkpoint.fixture_count });

  let completion = null;
  if (allComplete) completion = completeSeason(world);
  const saved = savePersistentWorld(world);
  const restored = loadPersistentWorld(saved);
  const restoredValidation = validatePersistentMatchdayWorld(restored);
  const persistedCheckpoint = allComplete
    ? restored.matchday_history.flatMap((row) => row.checkpoints).some((row) => row.checkpoint_id === checkpoint.checkpoint_id)
    : restored.matchday_cycle.checkpoints.some((row) => row.checkpoint_id === checkpoint.checkpoint_id);
  const checks = Object.freeze({
    one_checkpoint_added: persistedCheckpoint,
    no_fixture_replay: unique(Object.values(cycle.runtimes).flatMap((runtime) => runtime.state.applied_run_keys)),
    matchday_processed_in_every_division: resultRows.length === world.competition.divisions.length && resultRows.every((row) => row.matchday === matchday),
    save_load_valid: restoredValidation.valid,
    season_state_is_coherent: allComplete ? restored.phase === 'preseason' : restored.phase === 'season' && restored.matchday_cycle.current_matchday === matchday + 1,
    final_squads_viable_when_complete: !allComplete || allViable(restored, restored.clock),
    squad_cycle_integrity: squadCycleSnapshot(restored.squad_cycle).accepted
  });
  return Object.freeze({
    version: PERSISTENT_MATCHDAY_VERSION,
    season_id: cycle.season_id,
    matchday,
    division_results: Object.freeze(resultRows),
    checkpoint: Object.freeze(checkpoint),
    season_completed: allComplete,
    completion,
    saved_world: saved,
    world: restored,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

export function runPersistentMatchdays({ world, matchdays, humanInstructionsByMatchday = {}, daysBetweenRounds = 7 } = {}) {
  if (!Number.isInteger(matchdays) || matchdays < 1) throw new Error('Matchday count must be positive');
  let current = clone(world);
  const reports = [];
  const expected = [];
  for (let index = 0; index < matchdays; index += 1) {
    const expectedMatchday = current.matchday_cycle?.current_matchday || 1;
    expected.push(expectedMatchday);
    const report = advancePersistentMatchday(current, {
      humanInstruction: humanInstructionsByMatchday[expectedMatchday] || humanInstructionsByMatchday[String(expectedMatchday)] || {},
      daysBetweenRounds
    });
    reports.push(report);
    current = report.world;
  }
  const checks = Object.freeze({
    every_advance_accepted: reports.every((row) => row.accepted),
    checkpoints_are_unique: unique(reports.map((row) => row.checkpoint.checkpoint_id)),
    matchdays_are_sequential: reports.every((row, index) => row.matchday === expected[index]),
    final_world_valid: validatePersistentMatchdayWorld(current).valid
  });
  return Object.freeze({ version: PERSISTENT_MATCHDAY_VERSION, matchdays, reports: Object.freeze(reports), final_world: current, checks, accepted: Object.values(checks).every(Boolean) });
}
