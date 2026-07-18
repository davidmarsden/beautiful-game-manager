const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const EVENT_GENERATION_VERSION = 'tbg-event-generation-v0.1';
export const EVENT_GENERATION_STATE_KEY = 'module_d_event_generation';

export const EVENT_DIALS = Object.freeze({
  base_chances_per_side: 11,
  base_conversion_rate: 0.10,
  home_factor: 1.045,
  tempo_slow: 0.88,
  tempo_normal: 1,
  tempo_fast: 1.12,
  minimum_expected_goals: 0.15,
  maximum_expected_goals: 3.80,
  card_base_rate: 1.55,
  set_piece_share: 0.24,
  shot_on_target_share: 0.34,
  commentary_hook_limit: 12
});

const TEMPO_FACTOR = Object.freeze({ slow: EVENT_DIALS.tempo_slow, normal: EVENT_DIALS.tempo_normal, fast: EVENT_DIALS.tempo_fast });
const EVENT_PRIORITY = Object.freeze({ goal: 5, red_card: 4, injury: 4, penalty: 3, big_chance: 2, yellow_card: 1, set_piece: 1, shot: 0 });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedText) {
  let state = hashSeed(seedText) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fixtureSeed(contract = {}) {
  const fixture = contract.fixture || {};
  return [
    fixture.fixture_id || fixture.id || 'fixture',
    fixture.season_id || fixture.season || contract.season_id || '',
    fixture.round || fixture.matchday || contract.round || '',
    fixture.date || fixture.kickoff_at || fixture.scheduled_at || '',
    contract.run_key || ''
  ].join('|');
}

function tempoFactor(team = {}) {
  return TEMPO_FACTOR[text(team?.tactics?.tempo)] || 1;
}

function lineStrength(quality, context, tactical, unit) {
  const unitQuality = number(quality?.units?.[unit]?.effective_quality, number(quality?.team_strength, 50));
  const fitness = number(context?.team?.fitness_modifier, 1);
  const sharpness = number(context?.team?.sharpness_modifier, 1);
  const morale = number(context?.team?.morale_modifier, 1);
  const familiarity = number(context?.familiarity?.mean_modifier, 1);
  const shapeKey = unit === 'defence' ? 'defence' : unit === 'midfield' ? 'midfield' : 'attack';
  const shape = number(tactical?.shape_weights?.[shapeKey], 1 / 3) * 3;
  return round(unitQuality * fitness * sharpness * morale * familiarity * shape, 4);
}

function controlShare(ownMidfield, opponentMidfield) {
  const total = Math.max(0.0001, ownMidfield + opponentMidfield);
  return clamp(ownMidfield / total, 0.25, 0.75);
}

function tacticalFactor(matchup, side) {
  const advantage = number(matchup?.net?.[`${side}_advantage`], 0);
  return clamp(1 + advantage, 0.85, 1.15);
}

function expectedSide(side, inputs) {
  const opponentSide = side === 'home' ? 'away' : 'home';
  const own = inputs[side];
  const opponent = inputs[opponentSide];
  const ownAttack = lineStrength(own.quality, own.context, own.tactical, 'attack');
  const ownMidfield = lineStrength(own.quality, own.context, own.tactical, 'midfield');
  const opponentMidfield = lineStrength(opponent.quality, opponent.context, opponent.tactical, 'midfield');
  const opponentDefence = lineStrength(opponent.quality, opponent.context, opponent.tactical, 'defence');
  const opponentGoalkeeper = number(opponent.quality?.units?.goalkeeping?.effective_quality, opponentDefence);
  const control = controlShare(ownMidfield, opponentMidfield);
  const tempo = tempoFactor(own.team);
  const matchup = tacticalFactor(inputs.matchup, side);
  const effectiveAttack = ownAttack * matchup * tempo;
  const effectiveDefence = opponentDefence * tacticalFactor(inputs.matchup, opponentSide);
  const attackShare = clamp(effectiveAttack / Math.max(0.0001, effectiveAttack + effectiveDefence), 0.25, 0.75);
  const expectedChances = EVENT_DIALS.base_chances_per_side * tempo * (0.72 + control * 0.56) * (0.72 + attackShare * 0.56);
  const finishingEdge = clamp((ownAttack - average([opponentDefence, opponentGoalkeeper])) / 100, -0.18, 0.18);
  const conversion = clamp(EVENT_DIALS.base_conversion_rate + finishingEdge * 0.055, 0.065, 0.145);
  const homeFactor = side === 'home' ? EVENT_DIALS.home_factor : 1;
  const expectedGoals = clamp(expectedChances * conversion * homeFactor, EVENT_DIALS.minimum_expected_goals, EVENT_DIALS.maximum_expected_goals);
  const setPieces = expectedChances * EVENT_DIALS.set_piece_share;
  const cards = EVENT_DIALS.card_base_rate * (0.85 + number(own.context?.team?.average_workload, 1) * 0.15);

  return deepFreeze({
    side,
    line_strengths: { attack: ownAttack, midfield: ownMidfield, defence_faced: opponentDefence, goalkeeper_faced: round(opponentGoalkeeper, 4) },
    control_share: round(control, 4),
    tempo_factor: round(tempo, 4),
    tactical_factor: round(matchup, 4),
    attack_share: round(attackShare, 4),
    expected_chances: round(expectedChances, 3),
    expected_goals: round(expectedGoals, 3),
    conversion_rate: round(conversion, 4),
    expected_set_pieces: round(setPieces, 3),
    expected_cards: round(cards, 3)
  });
}

function weightedPlayer(players, unit, random) {
  const eligible = players.filter((player) => {
    const role = player.required_role;
    if (unit === 'attack') return ['wing', 'st', 'am'].includes(role);
    if (unit === 'midfield') return ['dm', 'cm', 'am', 'wide_mid'].includes(role);
    return ['fb', 'cb', 'wing_back', 'gk'].includes(role);
  });
  const pool = eligible.length ? eligible : players;
  const weights = pool.map((player) => Math.max(1, number(player.effective_quality, 50)));
  const target = random() * weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  for (let index = 0; index < pool.length; index += 1) {
    cursor += weights[index];
    if (target <= cursor) return pool[index];
  }
  return pool[pool.length - 1] || null;
}

function sampleCount(mean, random, maximum = 30) {
  const whole = Math.floor(mean);
  const remainder = mean - whole;
  return Math.min(maximum, whole + (random() < remainder ? 1 : 0));
}

function buildSideEvents(side, expected, quality, context, random) {
  const events = [];
  const chanceCount = sampleCount(expected.expected_chances, random, 24);
  const cardCount = sampleCount(expected.expected_cards, random, 6);
  const setPieceCount = sampleCount(expected.expected_set_pieces, random, 8);
  const players = quality?.starters || [];

  for (let index = 0; index < chanceCount; index += 1) {
    const minute = 1 + Math.floor(random() * 90);
    const actor = weightedPlayer(players, random() < 0.76 ? 'attack' : 'midfield', random);
    const chanceQuality = clamp(0.035 + random() * 0.22 + (expected.conversion_rate - 0.10) * 0.35, 0.025, 0.38);
    const onTarget = random() < clamp(EVENT_DIALS.shot_on_target_share + chanceQuality * 0.45, 0.22, 0.62);
    const goal = onTarget && random() < clamp(chanceQuality * 1.55, 0.04, 0.58);
    events.push({
      event_id: `${side}-chance-${index + 1}`,
      minute,
      side,
      type: goal ? 'goal' : chanceQuality >= 0.22 ? 'big_chance' : 'shot',
      player_id: actor?.player_id || null,
      xg: round(chanceQuality, 3),
      on_target: onTarget,
      outcome: goal ? 'goal' : onTarget ? 'saved' : 'missed',
      provisional: true,
      commentary_hook: goal ? 'goal' : chanceQuality >= 0.22 ? 'big_chance' : onTarget ? 'shot_on_target' : 'shot'
    });
  }

  for (let index = 0; index < setPieceCount; index += 1) {
    const minute = 1 + Math.floor(random() * 90);
    const penalty = random() < 0.055;
    events.push({
      event_id: `${side}-set-piece-${index + 1}`,
      minute,
      side,
      type: penalty ? 'penalty' : 'set_piece',
      subtype: penalty ? 'penalty_awarded' : random() < 0.72 ? 'corner' : 'free_kick',
      provisional: true,
      commentary_hook: penalty ? 'penalty_awarded' : 'set_piece'
    });
  }

  for (let index = 0; index < cardCount; index += 1) {
    const minute = 5 + Math.floor(random() * 84);
    const red = random() < 0.055;
    const actor = weightedPlayer(players, random() < 0.7 ? 'defence' : 'midfield', random);
    events.push({
      event_id: `${side}-card-${index + 1}`,
      minute,
      side,
      type: red ? 'red_card' : 'yellow_card',
      player_id: actor?.player_id || null,
      provisional: true,
      commentary_hook: red ? 'sending_off' : 'booking'
    });
  }

  const injuryProbability = clamp(number(context?.team?.average_injury_risk_90, 0), 0, 0.08) * 11;
  if (random() < injuryProbability) {
    const actor = players[Math.floor(random() * Math.max(1, players.length))] || null;
    events.push({
      event_id: `${side}-injury-1`,
      minute: 8 + Math.floor(random() * 80),
      side,
      type: 'injury',
      player_id: actor?.player_id || null,
      provisional: true,
      commentary_hook: 'injury'
    });
  }

  return events;
}

function orderEvents(events) {
  return events.sort((left, right) => left.minute - right.minute || (EVENT_PRIORITY[right.type] || 0) - (EVENT_PRIORITY[left.type] || 0) || left.event_id.localeCompare(right.event_id));
}

function commentaryHooks(events) {
  return events
    .filter((event) => event.commentary_hook)
    .sort((left, right) => (EVENT_PRIORITY[right.type] || 0) - (EVENT_PRIORITY[left.type] || 0) || left.minute - right.minute)
    .slice(0, EVENT_DIALS.commentary_hook_limit)
    .map((event) => deepFreeze({ minute: event.minute, side: event.side, hook: event.commentary_hook, event_id: event.event_id }));
}

export function resolveEventGeneration(contract, tactical, quality, fatigue) {
  if (!tactical?.home || !tactical?.away) throw new Error('Module D requires Module A tactical resolution');
  if (!quality?.home || !quality?.away) throw new Error('Module D requires Module B player quality');
  if (!fatigue?.home || !fatigue?.away) throw new Error('Module D requires Module C fatigue context');

  const inputs = {
    home: { team: contract.teams.home, tactical: tactical.home, quality: quality.home, context: fatigue.home },
    away: { team: contract.teams.away, tactical: tactical.away, quality: quality.away, context: fatigue.away },
    matchup: tactical.matchup
  };
  const home = expectedSide('home', inputs);
  const away = expectedSide('away', inputs);
  const seed = fixtureSeed(contract);
  const random = seededRandom(seed);
  const events = orderEvents([
    ...buildSideEvents('home', home, quality.home, fatigue.home, random),
    ...buildSideEvents('away', away, quality.away, fatigue.away, random)
  ]);

  const provisionalScore = events.reduce((score, event) => {
    if (event.type === 'goal') score[event.side] += 1;
    return score;
  }, { home: 0, away: 0 });

  return deepFreeze({
    version: EVENT_GENERATION_VERSION,
    seed_commitment: hashSeed(seed).toString(16).padStart(8, '0'),
    expected: { home, away },
    provisional_event_stream: events,
    provisional_score: provisionalScore,
    commentary_hooks: commentaryHooks(events),
    event_counts: {
      total: events.length,
      chances: events.filter((event) => ['shot', 'big_chance', 'goal'].includes(event.type)).length,
      goals: events.filter((event) => event.type === 'goal').length,
      cards: events.filter((event) => ['yellow_card', 'red_card'].includes(event.type)).length,
      set_pieces: events.filter((event) => ['set_piece', 'penalty'].includes(event.type)).length,
      injuries: events.filter((event) => event.type === 'injury').length
    },
    score_resolution_pending: true,
    state_updates_projected_only: true,
    applied_to_public_result: false
  });
}

export function executeEventGeneration(context) {
  const result = resolveEventGeneration(
    context.contract,
    context.get('module_a_tactical_resolution'),
    context.get('module_b_player_quality'),
    context.get('module_c_fatigue_context')
  );
  context.set(EVENT_GENERATION_STATE_KEY, result);
  return context;
}
