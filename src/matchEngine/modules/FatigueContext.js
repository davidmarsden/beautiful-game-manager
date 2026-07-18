const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const FATIGUE_CONTEXT_VERSION = 'tbg-fatigue-context-v0.1';
export const FATIGUE_CONTEXT_STATE_KEY = 'module_c_fatigue_context';

export const FATIGUE_DIALS = Object.freeze({
  match_cost_per_90: 35,
  recovery_per_rest_day: 9,
  fitness_modifier_floor: 0.60,
  sharpness_modifier_floor: 0.95,
  morale_modifier_minimum: 0.90,
  morale_modifier_maximum: 1.10,
  cohesion_narrowing_weight: 0.80,
  familiarity_narrowing_weight: 0.20,
  injury_baseline: 0.002,
  injury_fatigue_multiplier: 0.035
});

const ROLE_DEMAND = Object.freeze({
  gk: 0.62,
  cb: 0.92,
  fb: 1.06,
  wing_back: 1.16,
  dm: 1.00,
  cm: 1.06,
  am: 1.05,
  wide_mid: 1.10,
  wing: 1.10,
  st: 1.00,
  unknown: 1.00
});

const PRESSING_DEMAND = Object.freeze({ low: 0.92, mid: 1.00, high: 1.18 });
const TEMPO_DEMAND = Object.freeze({ slow: 0.93, normal: 1.00, fast: 1.10 });
const MORALE_LABELS = Object.freeze({
  terrible: 20,
  very_low: 25,
  low: 35,
  poor: 35,
  okay: 50,
  normal: 50,
  good: 60,
  very_good: 72,
  excellent: 82,
  superb: 90
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function stateContainer(world = {}) {
  return world.match_state || world.match_layer_state || world.engine_state || {};
}

function clubState(world, clubId) {
  const state = stateContainer(world);
  const clubs = state.clubs || state.club_states || world.club_match_state || {};
  if (Array.isArray(clubs)) return clubs.find((row) => String(row.club_id || row.tbg_club_id) === String(clubId)) || {};
  return clubs?.[clubId] || {};
}

function playerState(world, player) {
  const playerId = String(player?.tbg_player_id || player?.id || '');
  const state = stateContainer(world);
  const players = state.players || state.player_states || world.player_match_state || {};
  if (Array.isArray(players)) return players.find((row) => String(row.player_id || row.tbg_player_id) === playerId) || {};
  return players?.[playerId] || {};
}

export function fitnessModifier(fitness) {
  const value = clamp(number(fitness, 100), 0, 100);
  if (value >= 90) return 1;
  const scaled = Math.pow(value / 90, 1.35);
  return round(FATIGUE_DIALS.fitness_modifier_floor + (1 - FATIGUE_DIALS.fitness_modifier_floor) * scaled, 4);
}

export function sharpnessModifier(sharpness) {
  const value = clamp(number(sharpness, 100), 0, 100);
  if (value >= 75) return 1;
  return round(FATIGUE_DIALS.sharpness_modifier_floor + (1 - FATIGUE_DIALS.sharpness_modifier_floor) * (value / 75), 4);
}

function moraleValue(player, state) {
  const raw = state.morale ?? player?.condition?.morale ?? player?.morale ?? 50;
  const numeric = number(raw, null);
  if (numeric !== null) return clamp(numeric, 0, 100);
  return MORALE_LABELS[text(raw).replaceAll(' ', '_')] ?? 50;
}

export function moraleModifier(morale) {
  const value = clamp(number(morale, 50), 0, 100);
  const centred = (value - 50) / 50;
  return round(clamp(1 + centred * 0.10, FATIGUE_DIALS.morale_modifier_minimum, FATIGUE_DIALS.morale_modifier_maximum), 4);
}

function workRate(player) {
  return clamp(number(player?.work_rate_rating ?? player?.work_rate ?? player?.workrate, 50), 0, 100);
}

function resolveRole(teamQuality, index) {
  return teamQuality?.starters?.[index]?.required_role || 'unknown';
}

function workloadMultiplier(team, role, player) {
  const pressing = PRESSING_DEMAND[text(team?.tactics?.pressing)] ?? 1;
  const tempo = TEMPO_DEMAND[text(team?.tactics?.tempo)] ?? 1;
  const roleDemand = ROLE_DEMAND[role] ?? ROLE_DEMAND.unknown;
  const workRateDemand = 0.90 + workRate(player) / 500;
  return round(clamp(pressing * tempo * roleDemand * workRateDemand, 0.55, 1.55), 4);
}

function injuryRisk(fitness, workload) {
  const fatigue = 1 - clamp(fitness, 0, 100) / 100;
  return round(clamp(
    FATIGUE_DIALS.injury_baseline + FATIGUE_DIALS.injury_fatigue_multiplier * fatigue * workload,
    0,
    0.08
  ), 5);
}

export function resolvePlayerContext(player, team, role, world) {
  const state = playerState(world, player);
  const fitness = clamp(number(state.fitness ?? player?.condition?.fitness ?? player?.fitness, 100), 0, 100);
  const sharpness = clamp(number(state.sharpness ?? player?.condition?.sharpness ?? player?.sharpness, 100), 0, 100);
  const morale = moraleValue(player, state);
  const workload = workloadMultiplier(team, role, player);
  const projectedCost = FATIGUE_DIALS.match_cost_per_90 * workload;
  const projectedFitness = clamp(fitness - projectedCost, 0, 100);

  return deepFreeze({
    player_id: String(player?.tbg_player_id || player?.id || ''),
    role,
    fitness: round(fitness, 2),
    fitness_modifier: fitnessModifier(fitness),
    sharpness: round(sharpness, 2),
    sharpness_modifier: sharpnessModifier(sharpness),
    morale: round(morale, 2),
    morale_modifier: moraleModifier(morale),
    work_rate: round(workRate(player), 2),
    workload_multiplier: workload,
    projected_match_cost_90: round(projectedCost, 3),
    projected_post_match_fitness_90: round(projectedFitness, 3),
    injury_risk_90: injuryRisk(fitness, workload)
  });
}

function tacticalPackage(team, tacticalResolution) {
  const resolved = tacticalResolution || {};
  return [
    resolved.formation || text(team?.formation) || '4-3-3-wide',
    resolved.style || 'balanced',
    resolved.route_to_goal || 'balanced'
  ].join('|');
}

function previousLineup(team, club) {
  return team?.previous_starting_xi || club?.previous_starting_xi || club?.last_starting_xi || null;
}

function continuityScore(team, club) {
  const previous = previousLineup(team, club);
  if (!Array.isArray(previous) || !previous.length) return 1;
  const previousIds = new Set(previous.map(String));
  const current = Array.isArray(team?.starting_xi) ? team.starting_xi.map(String) : [];
  return round(current.filter((id) => previousIds.has(id)).length / Math.max(11, current.length), 4);
}

function familiarityScore(team, club, packageKey) {
  const sources = [
    team?.tactical_familiarity,
    club?.tactical_familiarity,
    club?.familiarity,
    club?.systems
  ];
  for (const source of sources) {
    if (Number.isFinite(Number(source))) return clamp(Number(source), 0, 100);
    if (source && Number.isFinite(Number(source[packageKey]))) return clamp(Number(source[packageKey]), 0, 100);
  }
  return 50;
}

function cohesionScore(team, club, continuity) {
  const base = clamp(number(team?.cohesion ?? club?.cohesion ?? club?.squad_cohesion, 50), 0, 100);
  return round(clamp(base * (0.65 + continuity * 0.35), 0, 100), 3);
}

function familiarityModifier(score) {
  return round(0.98 + clamp(score, 0, 100) / 2500, 4);
}

function narrowing(score, maximum) {
  return round(maximum * Math.sqrt(clamp(score, 0, 100) / 100), 4);
}

export function resolveTeamContext(team, playersById, world = {}, tacticalResolution = null, teamQuality = null) {
  const ids = Array.isArray(team?.starting_xi) ? team.starting_xi.map(String) : [];
  if (ids.length !== 11) throw new Error(`Module C starting XI must contain 11 players; received ${ids.length}`);
  const players = ids.map((id) => {
    const player = playersById.get(id);
    if (!player) throw new Error(`Module C player not found: ${id}`);
    return player;
  });

  const club = clubState(world, team?.club_id);
  const packageKey = tacticalPackage(team, tacticalResolution);
  const continuity = continuityScore(team, club);
  const cohesion = cohesionScore(team, club, continuity);
  const familiarity = familiarityScore(team, club, packageKey);
  const playerContexts = players.map((player, index) => resolvePlayerContext(player, team, resolveRole(teamQuality, index), world));
  const averageFitness = average(playerContexts.map((row) => row.fitness));
  const averageMorale = average(playerContexts.map((row) => row.morale));
  const averageWorkload = average(playerContexts.map((row) => row.workload_multiplier));
  const cohesionNarrowing = narrowing(cohesion, 0.22);
  const familiarityNarrowing = narrowing(familiarity, 0.10);
  const weightedNarrowing = cohesionNarrowing * FATIGUE_DIALS.cohesion_narrowing_weight
    + familiarityNarrowing * FATIGUE_DIALS.familiarity_narrowing_weight;

  return deepFreeze({
    version: FATIGUE_CONTEXT_VERSION,
    side: text(team?.side),
    club_id: String(team?.club_id || '') || null,
    tactical_package: packageKey,
    players: playerContexts,
    team: {
      average_fitness: round(averageFitness, 3),
      fitness_modifier: round(average(playerContexts.map((row) => row.fitness_modifier)), 4),
      average_sharpness: round(average(playerContexts.map((row) => row.sharpness)), 3),
      sharpness_modifier: round(average(playerContexts.map((row) => row.sharpness_modifier)), 4),
      average_morale: round(averageMorale, 3),
      morale_modifier: moraleModifier(averageMorale),
      average_workload: round(averageWorkload, 4),
      projected_average_post_match_fitness_90: round(average(playerContexts.map((row) => row.projected_post_match_fitness_90)), 3),
      average_injury_risk_90: round(average(playerContexts.map((row) => row.injury_risk_90)), 5)
    },
    rotation: {
      continuity: continuity,
      changed_starters: round(11 * (1 - continuity), 0)
    },
    cohesion: {
      score: cohesion,
      narrowing: cohesionNarrowing
    },
    familiarity: {
      score: round(familiarity, 3),
      mean_modifier: familiarityModifier(familiarity),
      narrowing: familiarityNarrowing
    },
    variance: {
      cohesion_weight: FATIGUE_DIALS.cohesion_narrowing_weight,
      familiarity_weight: FATIGUE_DIALS.familiarity_narrowing_weight,
      total_narrowing: round(weightedNarrowing, 4),
      dispersion_multiplier: round(clamp(1 - weightedNarrowing, 0.72, 1), 4)
    }
  });
}

export function executeFatigueContext(context) {
  const tactical = context.get('module_a_tactical_resolution') || {};
  const quality = context.get('module_b_player_quality') || {};
  const result = deepFreeze({
    version: FATIGUE_CONTEXT_VERSION,
    dials: FATIGUE_DIALS,
    home: resolveTeamContext(context.teams.home, context.playersById, context.world, tactical.home, quality.home),
    away: resolveTeamContext(context.teams.away, context.playersById, context.world, tactical.away, quality.away),
    state_updates_projected_only: true,
    applied_to_public_result: false
  });
  context.set(FATIGUE_CONTEXT_STATE_KEY, result);
  return context;
}
