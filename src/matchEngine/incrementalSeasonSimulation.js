import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';
import { FATIGUE_DIALS } from './modules/FatigueContext.js';
import { makeManagerDecision } from './managerDecision.js';
import {
  applyAvailabilityChanges,
  availabilityForPlayer,
  availabilitySnapshot,
  createSquadAvailability
} from './squadAvailability.js';
import { buildDoubleRoundRobin } from './seasonSimulation.js';

export const INCREMENTAL_SEASON_VERSION = 'tbg-incremental-season-v1.1';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const text = (value) => String(value ?? '').trim();
const unique = (values) => new Set(values).size === values.length;
const clone = (value) => JSON.parse(JSON.stringify(value));
const SUPPORTED_FORMATIONS = new Set(['4-3-3-wide', '4-2-3-1', '4-4-2', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2']);
const ALLOWED_TACTICS = Object.freeze({
  style: new Set(['possession', 'counter_transition', 'direct', 'high_press', 'low_block', 'balanced']),
  route_to_goal: new Set(['central', 'balanced', 'wide']),
  pressing: new Set(['low', 'mid', 'high']),
  tempo: new Set(['slow', 'normal', 'fast']),
  mentality: new Set(['cautious', 'balanced', 'positive', 'attacking'])
});

function initialState(clubs) {
  const players = {};
  const clubsState = {};
  const playerIds = [];
  for (const club of clubs) {
    clubsState[club.club_id] = { previous_starting_xi: null, last_fixture_at: null };
    for (const player of club.players) {
      playerIds.push(player.tbg_player_id);
      players[player.tbg_player_id] = { fitness: 100, sharpness: 100, morale: 50 };
    }
  }
  return { players, clubs: clubsState, availability: createSquadAvailability(playerIds), applied_run_keys: [] };
}

function blankTable(clubs) {
  return Object.fromEntries(clubs.map((club) => [club.club_id, {
    club_id: club.club_id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0
  }]));
}

function finalTable(table) {
  return Object.freeze(Object.values(table)
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.club_id.localeCompare(b.club_id))
    .map((row, index) => Object.freeze({ position: index + 1, ...row })));
}

function updateTable(table, fixture, score) {
  const home = table[fixture.home_club_id];
  const away = table[fixture.away_club_id];
  home.played += 1; away.played += 1;
  home.gf += score.home; home.ga += score.away;
  away.gf += score.away; away.ga += score.home;
  if (score.home > score.away) { home.won += 1; away.lost += 1; home.points += 3; }
  else if (score.away > score.home) { away.won += 1; home.lost += 1; away.points += 3; }
  else { home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1; }
  home.gd = home.gf - home.ga; away.gd = away.gf - away.ga;
}

function recoverClub(state, club, kickoffAt) {
  const clubState = state.clubs[club.club_id];
  if (!clubState.last_fixture_at) return;
  const elapsed = Math.max(0, (new Date(kickoffAt) - new Date(clubState.last_fixture_at)) / 86400000);
  for (const player of club.players) {
    const row = state.players[player.tbg_player_id];
    row.fitness = clamp(row.fitness + elapsed * FATIGUE_DIALS.recovery_per_rest_day, 0, 100);
  }
}

function averageSquadRating(club) {
  return club.players.reduce((sum, player) => sum + Number(player.underlying_ability_rating ?? 75), 0) / Math.max(1, club.players.length);
}

function registerEmergencyPlayers(state, players) {
  for (const player of players) {
    const id = player.tbg_player_id;
    if (!state.players[id]) state.players[id] = { fitness: 100, sharpness: 100, morale: 50, temporary_emergency_callup: true };
    if (!state.availability.players[id]) {
      state.availability.players[id] = { injury_until_matchday: 0, suspension_until_matchday: 0, injury_reason: null, suspension_reason: null };
    }
  }
}

function selectTeam(club, opponent, state, matchday, side) {
  const managerDecision = makeManagerDecision({
    club,
    opponent: { club_id: opponent.club_id, average_rating: averageSquadRating(opponent) },
    side,
    matchday,
    playerState: state.players,
    previousStartingXi: state.clubs[club.club_id].previous_starting_xi,
    availability: (playerId, day) => availabilityForPlayer(state.availability, playerId, day)
  });
  registerEmergencyPlayers(state, managerDecision.emergency_players);
  return {
    side,
    club_id: club.club_id,
    club_name: club.club_name,
    formation: managerDecision.formation,
    starting_xi: [...managerDecision.starting_xi],
    bench: [...managerDecision.bench],
    previous_starting_xi: state.clubs[club.club_id].previous_starting_xi,
    tactical_familiarity: 80,
    cohesion: 75,
    tactics: { ...managerDecision.tactics },
    manager_decision: managerDecision.decision,
    emergency_players: [...managerDecision.emergency_players]
  };
}

function contractState(state, teams) {
  const ids = [...teams.home.starting_xi, ...teams.home.bench, ...teams.away.starting_xi, ...teams.away.bench];
  return { players: Object.fromEntries(ids.map((id) => {
    const availability = state.availability.players[id] || { injury_until_matchday: 0, suspension_until_matchday: 0 };
    return [id, { ...state.players[id], unavailable_until_matchday: availability.injury_until_matchday, suspension_until_matchday: availability.suspension_until_matchday }];
  })) };
}

function normalizeInstruction(instruction = {}) {
  const formation = text(instruction.formation);
  if (formation && !SUPPORTED_FORMATIONS.has(formation)) throw new Error(`Unsupported human formation: ${formation}`);
  for (const [key, value] of Object.entries(instruction.tactics || {})) {
    if (!ALLOWED_TACTICS[key] || !ALLOWED_TACTICS[key].has(value)) throw new Error(`Unsupported human tactic: ${key}=${value}`);
  }
  return {
    formation: formation || null,
    tactics: { ...(instruction.tactics || {}) },
    starting_xi: instruction.starting_xi ? instruction.starting_xi.map(text) : null
  };
}

function fallbackSource() {
  return Object.freeze({ type: 'deterministic_fallback' });
}

function submittedSource(source = {}) {
  return Object.freeze({
    type: 'manager_submission',
    manager_id: source.manager_id || null,
    submission_id: source.submission_id || null,
    submitted_at: source.submitted_at || null
  });
}

function backfillLegacyInstructionSources(runtime) {
  for (const row of runtime.results || []) {
    for (const side of ['home', 'away']) {
      const team = row.teams?.[side];
      if (team && !team.instruction_source?.type) {
        team.instruction_source = {
          type: 'deterministic_fallback',
          inferred_from_legacy_result: true
        };
      }
    }
  }
}

function applySubmittedInstruction(team, instruction, club, matchState, availabilityState, matchday) {
  const normalized = normalizeInstruction(instruction);
  const registeredIds = club.players.map((player) => player.tbg_player_id);
  const eligibleIds = registeredIds.filter((id) => availabilityForPlayer(availabilityState, id, matchday).available);
  if (normalized.starting_xi) {
    if (normalized.starting_xi.length !== 11 || !unique(normalized.starting_xi)) throw new Error('Human starting XI must contain exactly eleven unique players');
    const ineligible = normalized.starting_xi.filter((id) => !eligibleIds.includes(id));
    if (ineligible.length) throw new Error(`Human XI contains unavailable, ineligible or unregistered players: ${ineligible.join(', ')}`);
    const pool = [...new Set([...team.starting_xi, ...team.bench, ...eligibleIds])];
    team.starting_xi = [...normalized.starting_xi];
    team.bench = pool.filter((id) => eligibleIds.includes(id) && !team.starting_xi.includes(id)).slice(0, 7);
    for (const id of [...team.starting_xi, ...team.bench]) {
      if (!matchState.players[id]) matchState.players[id] = { fitness: 100, sharpness: 100, morale: 50, unavailable_until_matchday: 0, suspension_until_matchday: 0 };
    }
  }
  if (normalized.formation) team.formation = normalized.formation;
  team.tactics = { ...team.tactics, ...normalized.tactics };
  team.manager_decision = { ...team.manager_decision, source: 'human', human_override: true };
}

function metrics(runtime, clubs) {
  const results = runtime.results;
  const totalGoals = results.reduce((sum, row) => sum + row.score.home + row.score.away, 0);
  const allStateRows = Object.values(runtime.state.players);
  return Object.freeze({
    total_goals: totalGoals,
    average_goals_per_match: round(totalGoals / Math.max(1, results.length), 3),
    home_win_rate: round(results.filter((row) => row.score.home > row.score.away).length / Math.max(1, results.length)),
    draw_rate: round(results.filter((row) => row.score.home === row.score.away).length / Math.max(1, results.length)),
    away_win_rate: round(results.filter((row) => row.score.away > row.score.home).length / Math.max(1, results.length)),
    minimum_final_fitness: round(Math.min(...allStateRows.map((row) => row.fitness)), 3),
    maximum_final_fitness: round(Math.max(...allStateRows.map((row) => row.fitness)), 3),
    unique_public_event_ids: runtime.event_ids.length,
    availability_changes: runtime.counters.availability_changes,
    injury_absences: runtime.counters.injury_absences,
    suspension_absences: runtime.counters.suspension_absences,
    unavailable_selections: runtime.counters.unavailable_selections,
    manager_decisions: runtime.counters.manager_decisions,
    total_rotations: runtime.counters.total_rotations,
    tactical_adjustments: runtime.counters.tactical_adjustments,
    emergency_youth_callups: runtime.counters.emergency_youth_callups,
    out_of_position_starters: runtime.counters.out_of_position_starters,
    registered_players: clubs.reduce((sum, club) => sum + club.players.length, 0)
  });
}

export function createIncrementalSeason({ clubs, seasonId, startAt, daysBetweenRounds = 7, humanClubId = null } = {}) {
  if (!Array.isArray(clubs) || clubs.length < 4) throw new Error('Incremental season requires clubs');
  const fixtures = buildDoubleRoundRobin(clubs.map((club) => club.club_id), { seasonId, startAt, daysBetweenRounds });
  return {
    version: INCREMENTAL_SEASON_VERSION,
    season_id: seasonId,
    ...(humanClubId ? { human_club_id: humanClubId } : {}),
    fixtures: fixtures.map((row) => ({ ...row })),
    next_matchday: 1,
    completed: false,
    state: initialState(clubs),
    table: blankTable(clubs),
    results: [],
    event_ids: [],
    human_decisions: [],
    counters: {
      availability_changes: 0, injury_absences: 0, suspension_absences: 0, unavailable_selections: 0,
      manager_decisions: 0, total_rotations: 0, tactical_adjustments: 0,
      emergency_youth_callups: 0, out_of_position_starters: 0
    }
  };
}

export function advanceIncrementalMatchday(runtime, {
  clubs,
  instructionsByClub = {},
  instructionSourcesByClub = {},
  humanInstruction = null,
  simulator = simulateMatch
} = {}) {
  if (runtime.completed) throw new Error(`Season already complete: ${runtime.season_id}`);
  backfillLegacyInstructionSources(runtime);
  const clubMap = new Map(clubs.map((club) => [club.club_id, club]));
  const fixtures = runtime.fixtures.filter((fixture) => fixture.matchday === runtime.next_matchday);
  if (!fixtures.length) throw new Error(`No fixtures for matchday ${runtime.next_matchday}`);
  const resolvedInstructions = { ...instructionsByClub };
  const resolvedSources = { ...instructionSourcesByClub };
  if (humanInstruction && runtime.human_club_id && !resolvedInstructions[runtime.human_club_id]) {
    resolvedInstructions[runtime.human_club_id] = humanInstruction;
    resolvedSources[runtime.human_club_id] ||= { type: 'manager_submission' };
  }

  for (const fixture of fixtures) {
    const homeClub = clubMap.get(fixture.home_club_id);
    const awayClub = clubMap.get(fixture.away_club_id);
    recoverClub(runtime.state, homeClub, fixture.kickoff_at);
    recoverClub(runtime.state, awayClub, fixture.kickoff_at);
    const beforeSelection = availabilitySnapshot(runtime.state.availability, fixture.matchday);
    const teams = {
      home: selectTeam(homeClub, awayClub, runtime.state, fixture.matchday, 'home'),
      away: selectTeam(awayClub, homeClub, runtime.state, fixture.matchday, 'away')
    };
    runtime.counters.manager_decisions += 2;
    runtime.counters.total_rotations += teams.home.manager_decision.rotation_count + teams.away.manager_decision.rotation_count;
    runtime.counters.emergency_youth_callups += teams.home.manager_decision.emergency_youth_count + teams.away.manager_decision.emergency_youth_count;
    runtime.counters.out_of_position_starters += teams.home.manager_decision.out_of_position_count + teams.away.manager_decision.out_of_position_count;
    runtime.counters.tactical_adjustments += Number(JSON.stringify(teams.home.tactics) !== JSON.stringify(homeClub.tactics));
    runtime.counters.tactical_adjustments += Number(JSON.stringify(teams.away.tactics) !== JSON.stringify(awayClub.tactics));

    const matchState = contractState(runtime.state, teams);
    const instructions = {
      home: resolvedInstructions[fixture.home_club_id],
      away: resolvedInstructions[fixture.away_club_id]
    };
    const instructionSources = {
      home: instructions.home ? submittedSource(resolvedSources[fixture.home_club_id]) : fallbackSource(),
      away: instructions.away ? submittedSource(resolvedSources[fixture.away_club_id]) : fallbackSource()
    };
    for (const side of ['home', 'away']) {
      if (!instructions[side]) continue;
      const club = side === 'home' ? homeClub : awayClub;
      applySubmittedInstruction(teams[side], instructions[side], club, matchState, runtime.state.availability, fixture.matchday);
      runtime.human_decisions.push({
        fixture_id: fixture.fixture_id,
        matchday: fixture.matchday,
        club_id: club.club_id,
        side,
        formation: teams[side].formation,
        tactics: { ...teams[side].tactics },
        starting_xi: [...teams[side].starting_xi],
        instruction_source: clone(instructionSources[side])
      });
    }

    const selectedIds = [...teams.home.starting_xi, ...teams.home.bench, ...teams.away.starting_xi, ...teams.away.bench];
    runtime.counters.unavailable_selections += selectedIds.filter((id) => !availabilityForPlayer(runtime.state.availability, id, fixture.matchday).available).length;
    const world = { players: [...homeClub.players, ...awayClub.players, ...teams.home.emergency_players, ...teams.away.emergency_players] };
    const contract = {
      contract_version: '2d2-v1', engine_mode: MATCH_ENGINE_MODES.constitutional,
      run_key: `${runtime.season_id}:${fixture.fixture_id}`, fixture, teams, match_state: matchState
    };
    if (runtime.state.applied_run_keys.includes(contract.run_key)) throw new Error(`Fixture already applied: ${fixture.fixture_id}`);
    const result = simulator(contract, world);
    for (const event of result.events || []) {
      const eventId = text(event.event_id);
      if (!eventId || runtime.event_ids.includes(eventId)) throw new Error(`Invalid or duplicate event ID: ${eventId}`);
      runtime.event_ids.push(eventId);
    }
    for (const row of result.state_changes?.fitness || []) {
      if (runtime.state.players[row.player_id]) runtime.state.players[row.player_id].fitness = clamp(Number(row.projected_post_match_fitness), 0, 100);
    }
    const availabilityChanges = applyAvailabilityChanges(runtime.state.availability, result, fixture);
    runtime.counters.availability_changes += availabilityChanges.length;
    runtime.counters.injury_absences += availabilityChanges.filter((row) => row.kind === 'injury').length;
    runtime.counters.suspension_absences += availabilityChanges.filter((row) => row.kind === 'suspension').length;
    runtime.state.applied_run_keys.push(contract.run_key);
    runtime.state.clubs[homeClub.club_id].previous_starting_xi = [...teams.home.starting_xi];
    runtime.state.clubs[awayClub.club_id].previous_starting_xi = [...teams.away.starting_xi];
    runtime.state.clubs[homeClub.club_id].last_fixture_at = fixture.kickoff_at;
    runtime.state.clubs[awayClub.club_id].last_fixture_at = fixture.kickoff_at;
    updateTable(runtime.table, fixture, result.score);
    runtime.results.push({
      fixture: { ...fixture }, score: result.score, outcome: result.outcome, statistics: result.statistics,
      events: (result.events || []).map((row) => ({ ...row })), lineup_state: result.lineup_state,
      teams: {
        home: { starting_xi: [...teams.home.starting_xi], bench: [...teams.home.bench], formation: teams.home.formation, tactics: { ...teams.home.tactics }, manager_decision: { ...teams.home.manager_decision }, instruction_source: clone(instructionSources.home) },
        away: { starting_xi: [...teams.away.starting_xi], bench: [...teams.away.bench], formation: teams.away.formation, tactics: { ...teams.away.tactics }, manager_decision: { ...teams.away.manager_decision }, instruction_source: clone(instructionSources.away) }
      },
      unavailable_before_selection: beforeSelection.unavailable,
      availability_changes: availabilityChanges
    });
  }

  const processedMatchday = runtime.next_matchday;
  runtime.next_matchday += 1;
  runtime.completed = runtime.results.length === runtime.fixtures.length;
  return Object.freeze({
    season_id: runtime.season_id,
    matchday: processedMatchday,
    fixtures_processed: fixtures.length,
    results_total: runtime.results.length,
    completed: runtime.completed,
    standings: finalTable(runtime.table)
  });
}

export function incrementalSeasonReport(runtime, { clubs } = {}) {
  backfillLegacyInstructionSources(runtime);
  const standings = finalTable(runtime.table);
  const complete = runtime.completed && runtime.results.length === runtime.fixtures.length;
  const checks = Object.freeze({
    every_fixture_played_once: complete && runtime.state.applied_run_keys.length === runtime.fixtures.length,
    balanced_played_counts: complete && standings.every((row) => row.played === (clubs.length - 1) * 2),
    goals_for_equals_goals_against: standings.reduce((sum, row) => sum + row.gf, 0) === standings.reduce((sum, row) => sum + row.ga, 0),
    points_reconcile: standings.every((row) => row.points === row.won * 3 + row.drawn),
    records_reconcile: standings.every((row) => row.played === row.won + row.drawn + row.lost),
    globally_unique_event_ids: unique(runtime.event_ids),
    no_duplicate_state_application: unique(runtime.state.applied_run_keys) && runtime.state.applied_run_keys.length === runtime.results.length,
    unavailable_players_are_never_selected: runtime.counters.unavailable_selections === 0,
    manager_decision_for_every_team: runtime.counters.manager_decisions === runtime.fixtures.length * 2,
    every_club_fields_eleven: runtime.results.every((row) => row.teams.home.starting_xi.length === 11 && row.teams.away.starting_xi.length === 11),
    instruction_source_for_every_team: runtime.results.every((row) => row.teams.home.instruction_source?.type && row.teams.away.instruction_source?.type)
  });
  const lastMatchday = Math.max(...runtime.fixtures.map((row) => row.matchday));
  return Object.freeze({
    version: INCREMENTAL_SEASON_VERSION,
    season_id: runtime.season_id,
    club_count: clubs.length,
    fixture_count: runtime.fixtures.length,
    results: Object.freeze(runtime.results.map((row) => Object.freeze(row))),
    standings,
    final_availability: availabilitySnapshot(runtime.state.availability, lastMatchday + 1),
    metrics: metrics(runtime, clubs),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
