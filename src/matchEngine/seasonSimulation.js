import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';
import { FATIGUE_DIALS } from './modules/FatigueContext.js';
import {
  applyAvailabilityChanges,
  availabilityForPlayer,
  availabilitySnapshot,
  createSquadAvailability
} from './squadAvailability.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const text = (value) => String(value ?? '').trim();

export const SEASON_SIMULATION_VERSION = 'tbg-stateful-season-harness-v1.1';

const DEFAULT_POSITIONS = Object.freeze([
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger',
  'Goalkeeper', 'Centre-Back', 'Left-Back', 'Central Midfield',
  'Attacking Midfield', 'Right Winger', 'Centre-Forward'
]);

function addDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function unique(values) { return new Set(values).size === values.length; }

export function buildDoubleRoundRobin(clubIds, { seasonId = 'season', startAt = '2026-08-01T15:00:00.000Z', daysBetweenRounds = 7 } = {}) {
  if (!Array.isArray(clubIds) || clubIds.length < 4 || clubIds.length % 2 !== 0) throw new Error('Season schedule requires an even number of at least four clubs');
  if (!unique(clubIds.map(String))) throw new Error('Season schedule club IDs must be unique');
  const rotating = clubIds.map(String);
  const rounds = [];
  for (let roundIndex = 0; roundIndex < rotating.length - 1; roundIndex += 1) {
    const matches = [];
    for (let index = 0; index < rotating.length / 2; index += 1) {
      const left = rotating[index];
      const right = rotating[rotating.length - 1 - index];
      const swap = (roundIndex + index) % 2 === 1;
      matches.push({ home_club_id: swap ? right : left, away_club_id: swap ? left : right });
    }
    rounds.push(matches);
    rotating.splice(1, 0, rotating.pop());
  }
  const fixtures = [];
  for (let leg = 0; leg < 2; leg += 1) {
    rounds.forEach((matches, roundIndex) => {
      const matchday = leg * rounds.length + roundIndex + 1;
      const kickoffAt = addDays(startAt, (matchday - 1) * daysBetweenRounds);
      matches.forEach((match, matchIndex) => {
        const home = leg === 0 ? match.home_club_id : match.away_club_id;
        const away = leg === 0 ? match.away_club_id : match.home_club_id;
        fixtures.push(Object.freeze({
          fixture_id: `${seasonId}:md${matchday}:m${matchIndex + 1}`,
          season_id: seasonId,
          matchday,
          kickoff_at: kickoffAt,
          home_club_id: home,
          away_club_id: away
        }));
      });
    });
  }
  return Object.freeze(fixtures);
}

export function syntheticSeasonClubs({ clubCount = 6, baseRating = 86 } = {}) {
  if (clubCount < 4 || clubCount % 2 !== 0) throw new Error('Synthetic season requires an even number of at least four clubs');
  return Object.freeze(Array.from({ length: clubCount }, (_, clubIndex) => {
    const clubId = `club-${clubIndex + 1}`;
    const rating = baseRating + clubIndex;
    const players = DEFAULT_POSITIONS.map((position, playerIndex) => Object.freeze({
      tbg_player_id: `${clubId}-p${playerIndex + 1}`,
      display_name: `${clubId.toUpperCase()} ${playerIndex + 1}`,
      position,
      underlying_ability_rating: clamp(rating - (playerIndex >= 11 ? 3 : 0), 1, 100),
      work_rate: 55 + ((clubIndex + playerIndex) % 25)
    }));
    return Object.freeze({
      club_id: clubId,
      club_name: `Club ${clubIndex + 1}`,
      formation: clubIndex % 3 === 0 ? '4-3-3-wide' : clubIndex % 3 === 1 ? '4-2-3-1' : '4-4-2',
      tactics: clubIndex % 3 === 0
        ? { style: 'possession', route_to_goal: 'wide', pressing: 'mid', tempo: 'normal', mentality: 'balanced' }
        : clubIndex % 3 === 1
          ? { style: 'counter_transition', route_to_goal: 'central', pressing: 'mid', tempo: 'fast', mentality: 'balanced' }
          : { style: 'direct', route_to_goal: 'wide', pressing: 'low', tempo: 'fast', mentality: 'balanced' },
      players
    });
  }));
}

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
  return { players, clubs: clubsState, availability: createSquadAvailability(playerIds), applied_run_keys: new Set() };
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

function selectTeam(club, state, matchday, side) {
  const ranked = club.players
    .filter((player) => availabilityForPlayer(state.availability, player.tbg_player_id, matchday).available)
    .sort((left, right) => {
      const leftScore = left.underlying_ability_rating + state.players[left.tbg_player_id].fitness / 20;
      const rightScore = right.underlying_ability_rating + state.players[right.tbg_player_id].fitness / 20;
      return rightScore - leftScore || left.tbg_player_id.localeCompare(right.tbg_player_id);
    });
  if (ranked.length < 11) {
    throw new Error(`Season harness found only ${ranked.length} eligible players for ${club.club_id} on matchday ${matchday}`);
  }
  const goalkeeper = ranked.find((player) => player.position === 'Goalkeeper');
  if (!goalkeeper) throw new Error(`Season harness could not select an eligible goalkeeper for ${club.club_id} on matchday ${matchday}`);
  const outfield = ranked.filter((player) => player !== goalkeeper);
  const starters = [goalkeeper, ...outfield.slice(0, 10)];
  if (starters.length !== 11) throw new Error(`Season harness could not select 11 eligible players for ${club.club_id} on matchday ${matchday}`);
  const starterIds = starters.map((player) => player.tbg_player_id);
  const bench = ranked.filter((player) => !starterIds.includes(player.tbg_player_id)).slice(0, 7).map((player) => player.tbg_player_id);
  return {
    side,
    club_id: club.club_id,
    club_name: club.club_name,
    formation: club.formation,
    starting_xi: starterIds,
    bench,
    previous_starting_xi: state.clubs[club.club_id].previous_starting_xi,
    tactical_familiarity: 80,
    cohesion: 75,
    tactics: { ...club.tactics }
  };
}

function contractState(state, teams) {
  const ids = [...teams.home.starting_xi, ...teams.home.bench, ...teams.away.starting_xi, ...teams.away.bench];
  return { players: Object.fromEntries(ids.map((id) => {
    const availability = state.availability.players[id];
    return [id, {
      ...state.players[id],
      unavailable_until_matchday: availability.injury_until_matchday,
      suspension_until_matchday: availability.suspension_until_matchday
    }];
  })) };
}

function applyStateChanges(state, result, fixture) {
  if (state.applied_run_keys.has(result.run_key)) throw new Error(`Season harness attempted duplicate state application: ${result.run_key}`);
  for (const row of result.state_changes?.fitness || []) {
    if (!state.players[row.player_id]) continue;
    state.players[row.player_id].fitness = clamp(Number(row.projected_post_match_fitness), 0, 100);
  }
  const availabilityChanges = applyAvailabilityChanges(state.availability, result, fixture);
  state.applied_run_keys.add(result.run_key);
  return availabilityChanges;
}

function blankTable(clubs) {
  return Object.fromEntries(clubs.map((club) => [club.club_id, { club_id: club.club_id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
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

function finalTable(table) {
  return Object.freeze(Object.values(table).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.club_id.localeCompare(b.club_id)).map((row, index) => Object.freeze({ position: index + 1, ...row })));
}

export function simulateStatefulSeason({ clubs = syntheticSeasonClubs(), seasonId = 'season-sim', startAt, daysBetweenRounds = 7, simulator = simulateMatch } = {}) {
  const clubMap = new Map(clubs.map((club) => [club.club_id, club]));
  if (clubMap.size !== clubs.length) throw new Error('Season clubs must have unique IDs');
  const fixtures = buildDoubleRoundRobin([...clubMap.keys()], { seasonId, startAt, daysBetweenRounds });
  const state = initialState(clubs);
  const table = blankTable(clubs);
  const results = [];
  const eventIds = new Set();
  let totalEventCount = 0;
  let totalAvailabilityChanges = 0;
  let injuryAbsences = 0;
  let suspensionAbsences = 0;
  let unavailableSelections = 0;

  for (const fixture of fixtures) {
    const homeClub = clubMap.get(fixture.home_club_id);
    const awayClub = clubMap.get(fixture.away_club_id);
    recoverClub(state, homeClub, fixture.kickoff_at);
    recoverClub(state, awayClub, fixture.kickoff_at);
    const beforeSelection = availabilitySnapshot(state.availability, fixture.matchday);
    const teams = { home: selectTeam(homeClub, state, fixture.matchday, 'home'), away: selectTeam(awayClub, state, fixture.matchday, 'away') };
    const selectedIds = [...teams.home.starting_xi, ...teams.home.bench, ...teams.away.starting_xi, ...teams.away.bench];
    unavailableSelections += selectedIds.filter((id) => !availabilityForPlayer(state.availability, id, fixture.matchday).available).length;
    const world = { players: [...homeClub.players, ...awayClub.players] };
    const contract = {
      contract_version: '2d2-v1', engine_mode: MATCH_ENGINE_MODES.constitutional,
      run_key: `${seasonId}:${fixture.fixture_id}`,
      fixture,
      teams,
      match_state: contractState(state, teams)
    };
    const result = simulator(contract, world);
    if (result.fixture_id !== fixture.fixture_id) throw new Error(`Season result fixture mismatch: ${fixture.fixture_id}`);
    if (!unique(teams.home.starting_xi) || !unique(teams.away.starting_xi)) throw new Error(`Season harness produced duplicate starters: ${fixture.fixture_id}`);
    if (teams.home.starting_xi.some((id) => teams.home.bench.includes(id)) || teams.away.starting_xi.some((id) => teams.away.bench.includes(id))) throw new Error(`Season harness produced XI/bench overlap: ${fixture.fixture_id}`);
    for (const event of result.events || []) {
      totalEventCount += 1;
      const eventId = text(event.event_id);
      if (!eventId) throw new Error(`Season harness found an event without a public event ID: ${fixture.fixture_id}`);
      if (eventIds.has(eventId)) throw new Error(`Season harness found duplicate public event ID: ${eventId}`);
      eventIds.add(eventId);
    }
    const availabilityChanges = applyStateChanges(state, result, fixture);
    totalAvailabilityChanges += availabilityChanges.length;
    injuryAbsences += availabilityChanges.filter((row) => row.kind === 'injury').length;
    suspensionAbsences += availabilityChanges.filter((row) => row.kind === 'suspension').length;
    state.clubs[homeClub.club_id].previous_starting_xi = teams.home.starting_xi;
    state.clubs[awayClub.club_id].previous_starting_xi = teams.away.starting_xi;
    state.clubs[homeClub.club_id].last_fixture_at = fixture.kickoff_at;
    state.clubs[awayClub.club_id].last_fixture_at = fixture.kickoff_at;
    updateTable(table, fixture, result.score);
    results.push(Object.freeze({
      fixture,
      score: result.score,
      outcome: result.outcome,
      statistics: result.statistics,
      lineup_state: result.lineup_state,
      teams: Object.freeze({
        home: Object.freeze({ starting_xi: Object.freeze([...teams.home.starting_xi]), bench: Object.freeze([...teams.home.bench]) }),
        away: Object.freeze({ starting_xi: Object.freeze([...teams.away.starting_xi]), bench: Object.freeze([...teams.away.bench]) })
      }),
      unavailable_before_selection: beforeSelection.unavailable,
      availability_changes: availabilityChanges
    }));
  }

  const totalGoals = results.reduce((sum, row) => sum + row.score.home + row.score.away, 0);
  const standings = finalTable(table);
  const allStateRows = Object.values(state.players);
  const finalAvailability = availabilitySnapshot(state.availability, fixtures.at(-1).matchday + 1);
  const checks = Object.freeze({
    every_fixture_played_once: results.length === fixtures.length && state.applied_run_keys.size === fixtures.length,
    balanced_played_counts: standings.every((row) => row.played === (clubs.length - 1) * 2),
    goals_for_equals_goals_against: standings.reduce((sum, row) => sum + row.gf, 0) === standings.reduce((sum, row) => sum + row.ga, 0),
    points_reconcile: standings.every((row) => row.points === row.won * 3 + row.drawn),
    records_reconcile: standings.every((row) => row.played === row.won + row.drawn + row.lost),
    globally_unique_event_ids: eventIds.size === totalEventCount,
    fitness_stays_bounded: allStateRows.every((row) => row.fitness >= 0 && row.fitness <= 100),
    no_duplicate_state_application: state.applied_run_keys.size === results.length,
    unavailable_players_are_never_selected: unavailableSelections === 0,
    availability_calendar_covers_every_player: Object.keys(state.availability.players).length === clubs.reduce((sum, club) => sum + club.players.length, 0)
  });
  return Object.freeze({
    version: SEASON_SIMULATION_VERSION,
    season_id: seasonId,
    club_count: clubs.length,
    fixture_count: fixtures.length,
    results: Object.freeze(results),
    standings,
    final_availability: finalAvailability,
    metrics: Object.freeze({
      total_goals: totalGoals,
      average_goals_per_match: round(totalGoals / Math.max(1, results.length), 3),
      home_win_rate: round(results.filter((row) => row.score.home > row.score.away).length / results.length),
      draw_rate: round(results.filter((row) => row.score.home === row.score.away).length / results.length),
      away_win_rate: round(results.filter((row) => row.score.away > row.score.home).length / results.length),
      minimum_final_fitness: round(Math.min(...allStateRows.map((row) => row.fitness)), 3),
      maximum_final_fitness: round(Math.max(...allStateRows.map((row) => row.fitness)), 3),
      unique_public_event_ids: eventIds.size,
      availability_changes: totalAvailabilityChanges,
      injury_absences: injuryAbsences,
      suspension_absences: suspensionAbsences,
      unavailable_selections: unavailableSelections
    }),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
