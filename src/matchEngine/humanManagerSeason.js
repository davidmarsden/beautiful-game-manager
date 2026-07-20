import { simulateMatch } from '../matchSimulation.js';
import { buildDoubleRoundRobin, simulateStatefulSeason, syntheticSeasonClubs } from './seasonSimulation.js';

export const HUMAN_MANAGER_SEASON_VERSION = 'tbg-human-manager-season-v1.0';

const SUPPORTED_FORMATIONS = new Set(['4-3-3-wide', '4-2-3-1', '4-4-2', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2']);
const ALLOWED_TACTICS = Object.freeze({
  style: new Set(['possession', 'counter_transition', 'direct', 'high_press', 'low_block', 'balanced']),
  route_to_goal: new Set(['central', 'balanced', 'wide']),
  pressing: new Set(['low', 'mid', 'high']),
  tempo: new Set(['slow', 'normal', 'fast']),
  mentality: new Set(['cautious', 'balanced', 'positive', 'attacking'])
});

const text = (value) => String(value ?? '').trim();
const unique = (values) => new Set(values).size === values.length;

function clubById(clubs, clubId) {
  const club = clubs.find((row) => row.club_id === clubId);
  if (!club) throw new Error(`Human manager club not found: ${clubId}`);
  return club;
}

function humanFixtures(fixtures, clubId) {
  return fixtures.filter((fixture) => fixture.home_club_id === clubId || fixture.away_club_id === clubId);
}

function validateTactics(tactics = {}) {
  for (const [key, value] of Object.entries(tactics)) {
    if (!ALLOWED_TACTICS[key]) throw new Error(`Unsupported human tactic: ${key}`);
    if (!ALLOWED_TACTICS[key].has(value)) throw new Error(`Unsupported ${key}: ${value}`);
  }
}

function normalizeInstruction(instruction = {}) {
  const formation = text(instruction.formation);
  if (formation && !SUPPORTED_FORMATIONS.has(formation)) throw new Error(`Unsupported human formation: ${formation}`);
  validateTactics(instruction.tactics);
  const startingXi = instruction.starting_xi ? instruction.starting_xi.map(text) : null;
  if (startingXi && (startingXi.length !== 11 || !unique(startingXi))) {
    throw new Error('Human starting XI must contain exactly eleven unique player IDs');
  }
  return Object.freeze({
    formation: formation || null,
    tactics: Object.freeze({ ...(instruction.tactics || {}) }),
    starting_xi: startingXi ? Object.freeze(startingXi) : null
  });
}

function instructionForMatchday(defaultInstruction, instructionsByMatchday, matchday) {
  const override = instructionsByMatchday?.[matchday] || instructionsByMatchday?.[String(matchday)] || {};
  return normalizeInstruction({
    formation: override.formation ?? defaultInstruction.formation,
    tactics: { ...defaultInstruction.tactics, ...(override.tactics || {}) },
    starting_xi: override.starting_xi ?? defaultInstruction.starting_xi
  });
}

function applyHumanInstruction(team, instruction) {
  const availableMatchdaySquad = [...team.starting_xi, ...team.bench];
  if (instruction.starting_xi) {
    const unavailable = instruction.starting_xi.filter((id) => !availableMatchdaySquad.includes(id));
    if (unavailable.length) throw new Error(`Human XI contains players outside the available matchday squad: ${unavailable.join(', ')}`);
    team.starting_xi = [...instruction.starting_xi];
    team.bench = availableMatchdaySquad.filter((id) => !instruction.starting_xi.includes(id)).slice(0, 7);
  }
  if (instruction.formation) team.formation = instruction.formation;
  team.tactics = { ...team.tactics, ...instruction.tactics, home_instruction: team.tactics?.home_instruction ?? null };
  team.manager_decision = {
    ...team.manager_decision,
    source: 'human',
    human_override: true,
    submitted_formation: team.formation,
    submitted_tactics: { ...team.tactics }
  };
}

export function prepareHumanManagerSeason({
  clubs = syntheticSeasonClubs(),
  humanClubId = clubs[0]?.club_id,
  seasonId = 'human-manager-season',
  startAt = '2026-08-01T15:00:00.000Z',
  daysBetweenRounds = 7
} = {}) {
  const club = clubById(clubs, humanClubId);
  const fixtures = buildDoubleRoundRobin(clubs.map((row) => row.club_id), { seasonId, startAt, daysBetweenRounds });
  const schedule = humanFixtures(fixtures, humanClubId).map((fixture) => Object.freeze({
    fixture_id: fixture.fixture_id,
    matchday: fixture.matchday,
    kickoff_at: fixture.kickoff_at,
    venue: fixture.home_club_id === humanClubId ? 'home' : 'away',
    opponent_club_id: fixture.home_club_id === humanClubId ? fixture.away_club_id : fixture.home_club_id
  }));
  return Object.freeze({
    version: HUMAN_MANAGER_SEASON_VERSION,
    season_id: seasonId,
    human_club: Object.freeze({ club_id: club.club_id, club_name: club.club_name, formation: club.formation, tactics: Object.freeze({ ...club.tactics }) }),
    squad: Object.freeze(club.players.map((player) => Object.freeze({
      player_id: player.tbg_player_id,
      display_name: player.display_name,
      position: player.position,
      rating: player.underlying_ability_rating
    }))),
    schedule: Object.freeze(schedule),
    required_decisions: schedule.length
  });
}

export function playHumanManagerSeason({
  clubs = syntheticSeasonClubs(),
  humanClubId = clubs[0]?.club_id,
  seasonId = 'human-manager-season',
  startAt = '2026-08-01T15:00:00.000Z',
  daysBetweenRounds = 7,
  defaultInstruction = {},
  instructionsByMatchday = {}
} = {}) {
  const prepared = prepareHumanManagerSeason({ clubs, humanClubId, seasonId, startAt, daysBetweenRounds });
  const normalizedDefault = normalizeInstruction(defaultInstruction);
  const decisionLedger = [];

  const simulator = (contract, world) => {
    const fixture = contract.fixture;
    const side = fixture.home_club_id === humanClubId ? 'home' : fixture.away_club_id === humanClubId ? 'away' : null;
    if (side) {
      const instruction = instructionForMatchday(normalizedDefault, instructionsByMatchday, fixture.matchday);
      applyHumanInstruction(contract.teams[side], instruction);
      decisionLedger.push(Object.freeze({
        fixture_id: fixture.fixture_id,
        matchday: fixture.matchday,
        side,
        formation: contract.teams[side].formation,
        tactics: Object.freeze({ ...contract.teams[side].tactics }),
        starting_xi: Object.freeze([...contract.teams[side].starting_xi])
      }));
    }
    return simulateMatch(contract, world);
  };

  const season = simulateStatefulSeason({ clubs, seasonId, startAt, daysBetweenRounds, simulator });
  const humanResults = season.results.filter((row) => row.fixture.home_club_id === humanClubId || row.fixture.away_club_id === humanClubId).map((row) => {
    const isHome = row.fixture.home_club_id === humanClubId;
    const goalsFor = isHome ? row.score.home : row.score.away;
    const goalsAgainst = isHome ? row.score.away : row.score.home;
    return Object.freeze({
      fixture_id: row.fixture.fixture_id,
      matchday: row.fixture.matchday,
      opponent_club_id: isHome ? row.fixture.away_club_id : row.fixture.home_club_id,
      venue: isHome ? 'home' : 'away',
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
      formation: row.teams[isHome ? 'home' : 'away'].formation,
      tactics: row.teams[isHome ? 'home' : 'away'].tactics,
      starting_xi: row.teams[isHome ? 'home' : 'away'].starting_xi
    });
  });
  const finalStanding = season.standings.find((row) => row.club_id === humanClubId);
  const checks = Object.freeze({
    season_completed: season.accepted,
    human_club_played_full_schedule: humanResults.length === prepared.required_decisions,
    human_decision_recorded_for_every_fixture: decisionLedger.length === prepared.required_decisions,
    every_human_decision_has_valid_xi: decisionLedger.every((row) => row.starting_xi.length === 11 && unique(row.starting_xi)),
    every_human_decision_has_tactics: decisionLedger.every((row) => row.tactics && Object.keys(row.tactics).length > 0),
    final_standing_available: Boolean(finalStanding)
  });

  return Object.freeze({
    version: HUMAN_MANAGER_SEASON_VERSION,
    season_id: seasonId,
    human_club_id: humanClubId,
    onboarding: prepared,
    decisions: Object.freeze(decisionLedger),
    results: Object.freeze(humanResults),
    final_standing: Object.freeze({ ...finalStanding }),
    final_table: season.standings,
    season_metrics: season.metrics,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
