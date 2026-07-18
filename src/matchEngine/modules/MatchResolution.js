const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 4) => Number(Number(value).toFixed(places));

export const MATCH_RESOLUTION_VERSION = 'tbg-match-resolution-v0.3';
export const MATCH_RESOLUTION_STATE_KEY = 'module_e_match_resolution';

const ALLOWED_EVENT_TYPES = new Set([
  'shot', 'big_chance', 'goal', 'set_piece', 'penalty', 'foul',
  'yellow_card', 'red_card', 'injury'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateEvent(event, seenIds) {
  const eventId = String(event?.event_id || '').trim();
  if (!eventId) throw new Error('Module E event is missing event_id');
  if (seenIds.has(eventId)) throw new Error(`Module E duplicate event_id: ${eventId}`);
  seenIds.add(eventId);
  const side = text(event?.side);
  if (!['home', 'away'].includes(side)) throw new Error(`Module E event has invalid side: ${side || 'missing'}`);
  const type = text(event?.type);
  if (!ALLOWED_EVENT_TYPES.has(type)) throw new Error(`Module E event has unsupported type: ${type || 'missing'}`);
  const minute = Math.trunc(number(event?.minute, -1));
  if (minute < 1 || minute > 120) throw new Error(`Module E event has invalid minute: ${event?.minute}`);
  if (type === 'goal') {
    if (event?.outcome && text(event.outcome) !== 'goal') throw new Error(`Module E goal event has inconsistent outcome: ${eventId}`);
    if (event?.on_target === false) throw new Error(`Module E goal event cannot be off target: ${eventId}`);
  }
  if (type === 'penalty' && text(event?.subtype) === 'penalty_attempt' && !['goal', 'saved', 'missed'].includes(text(event?.outcome))) {
    throw new Error(`Module E penalty attempt has invalid outcome: ${eventId}`);
  }
  return deepFreeze({ ...event, event_id: eventId, side, type, minute, provisional: false, official: true });
}

function orderEvents(events) {
  return events.sort((left, right) => left.minute - right.minute || left.event_id.localeCompare(right.event_id));
}

function validateLinks(events) {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  for (const awarded of events.filter((event) => event.type === 'penalty' && event.subtype === 'penalty_awarded')) {
    const foul = byId.get(awarded.source_event_id);
    const attempt = byId.get(awarded.linked_event_id);
    if (!foul || foul.type !== 'foul' || foul.subtype !== 'penalty_foul') throw new Error(`Module E penalty award is missing its source foul: ${awarded.event_id}`);
    if (!attempt || attempt.type !== 'penalty' || attempt.subtype !== 'penalty_attempt') throw new Error(`Module E penalty award is missing its attempt: ${awarded.event_id}`);
    if (attempt.parent_event_id !== awarded.event_id || attempt.source_event_id !== foul.event_id) throw new Error(`Module E penalty linkage is inconsistent: ${awarded.event_id}`);
    if (foul.linked_event_id !== awarded.event_id) throw new Error(`Module E penalty foul linkage is inconsistent: ${foul.event_id}`);
  }
}

function dismissalStatistics(events) {
  const explicitRedCards = events.filter((event) => event.type === 'red_card');
  const explicitlyDismissedPlayers = new Set(explicitRedCards.filter((event) => event.player_id).map((event) => String(event.player_id)));
  const yellowCardsByPlayer = new Map();
  for (const event of events.filter((row) => row.type === 'yellow_card' && row.player_id)) {
    const playerId = String(event.player_id);
    yellowCardsByPlayer.set(playerId, (yellowCardsByPlayer.get(playerId) || 0) + 1);
  }
  const secondYellowDismissals = [...yellowCardsByPlayer.entries()].filter(([playerId, count]) => count >= 2 && !explicitlyDismissedPlayers.has(playerId)).length;
  return deepFreeze({ red_cards: explicitRedCards.length + secondYellowDismissals, straight_red_cards: explicitRedCards.length, second_yellow_dismissals: secondYellowDismissals });
}

function isPenaltyAttempt(event) {
  return event.type === 'penalty' && event.subtype === 'penalty_attempt';
}

function isScoringEvent(event) {
  return event.type === 'goal' || (isPenaltyAttempt(event) && event.outcome === 'goal');
}

function sideStatistics(side, events, expected) {
  const own = events.filter((event) => event.side === side);
  const shots = own.filter((event) => ['shot', 'big_chance', 'goal'].includes(event.type) || isPenaltyAttempt(event));
  const onTarget = shots.filter((event) => event.on_target === true || event.type === 'goal');
  const goals = own.filter(isScoringEvent);
  const yellowCards = own.filter((event) => event.type === 'yellow_card');
  const dismissals = dismissalStatistics(own);
  const corners = own.filter((event) => event.type === 'set_piece' && event.subtype === 'corner');
  const freeKicks = own.filter((event) => event.type === 'set_piece' && event.subtype === 'free_kick');
  const penaltiesAwarded = own.filter((event) => event.type === 'penalty' && event.subtype === 'penalty_awarded');
  const penaltyAttempts = own.filter(isPenaltyAttempt);
  const injuries = own.filter((event) => event.type === 'injury');
  const foulsCommitted = own.filter((event) => event.type === 'foul');
  const foulsWon = events.filter((event) => event.type === 'foul' && event.against_side === side);
  const generatedXg = shots.reduce((sum, event) => sum + number(event.xg, 0), 0);
  return deepFreeze({
    goals: goals.length,
    shots: shots.length,
    shots_on_target: onTarget.length,
    big_chances: own.filter((event) => event.type === 'big_chance' || (event.type === 'goal' && number(event.xg, 0) >= 0.22) || isPenaltyAttempt(event)).length,
    expected_goals: round(generatedXg, 3),
    model_expected_goals: round(number(expected?.expected_goals, generatedXg), 3),
    generated_xg: round(generatedXg, 3),
    corners: corners.length,
    free_kicks: freeKicks.length,
    fouls_committed: foulsCommitted.length,
    fouls_won: foulsWon.length,
    penalties_awarded: penaltiesAwarded.length,
    penalties_taken: penaltyAttempts.length,
    penalties_scored: penaltyAttempts.filter((event) => event.outcome === 'goal').length,
    penalties_saved: penaltyAttempts.filter((event) => event.outcome === 'saved').length,
    penalties_missed: penaltyAttempts.filter((event) => event.outcome === 'missed').length,
    yellow_cards: yellowCards.length,
    red_cards: dismissals.red_cards,
    straight_red_cards: dismissals.straight_red_cards,
    second_yellow_dismissals: dismissals.second_yellow_dismissals,
    injuries: injuries.length
  });
}

function disciplinaryState(events) {
  const byPlayer = new Map();
  for (const event of events.filter((row) => ['yellow_card', 'red_card'].includes(row.type) && row.player_id)) {
    const key = String(event.player_id);
    const current = byPlayer.get(key) || { player_id: key, yellow_cards: 0, red_cards: 0 };
    if (event.type === 'yellow_card') current.yellow_cards += 1;
    if (event.type === 'red_card') current.red_cards += 1;
    byPlayer.set(key, current);
  }
  return [...byPlayer.values()].map((row) => deepFreeze({ ...row, sent_off: row.red_cards > 0 || row.yellow_cards >= 2, dismissal_type: row.red_cards > 0 ? 'straight_red' : row.yellow_cards >= 2 ? 'second_yellow' : null }));
}

function projectedStateChanges(events, fatigue) {
  const injuries = events.filter((event) => event.type === 'injury').map((event) => deepFreeze({ player_id: event.player_id, side: event.side, minute: event.minute, status: 'injury_assessment_required' }));
  const fitness = [];
  for (const side of ['home', 'away']) {
    for (const player of fatigue?.[side]?.players || []) fitness.push(deepFreeze({ player_id: player.player_id, side, starting_fitness: player.fitness, projected_post_match_fitness: player.projected_post_match_fitness_90 }));
  }
  return deepFreeze({ fitness, injuries, discipline: disciplinaryState(events), persistence_pending: true });
}

export function resolveMatch(eventGeneration, fatigue = {}) {
  if (!eventGeneration?.provisional_event_stream) throw new Error('Module E requires Module D event generation');
  const seenIds = new Set();
  const events = orderEvents(eventGeneration.provisional_event_stream.map((event) => validateEvent(event, seenIds)));
  validateLinks(events);
  const score = events.reduce((result, event) => {
    if (isScoringEvent(event)) result[event.side] += 1;
    return result;
  }, { home: 0, away: 0 });
  const expected = eventGeneration.expected || {};
  const statistics = deepFreeze({ home: sideStatistics('home', events, expected.home), away: sideStatistics('away', events, expected.away) });
  if (statistics.home.goals !== score.home || statistics.away.goals !== score.away) throw new Error('Module E score and event stream are inconsistent');
  return deepFreeze({
    version: MATCH_RESOLUTION_VERSION,
    seed_commitment: eventGeneration.seed_commitment || null,
    score,
    result: score.home > score.away ? 'home_win' : score.away > score.home ? 'away_win' : 'draw',
    official_event_stream: events,
    statistics,
    state_changes: projectedStateChanges(events, fatigue),
    consistency: { unique_event_ids: true, chronological_events: true, score_matches_goals: true, statistics_reconciled: true, expected_goals_derived_from_official_shots: true, dismissals_reconciled: true, linked_penalties_reconciled: true },
    resolution_complete: true,
    applied_to_public_result: false
  });
}

export function executeMatchResolution(context) {
  const result = resolveMatch(context.get('module_d_event_generation'), context.get('module_c_fatigue_context'));
  context.set(MATCH_RESOLUTION_STATE_KEY, result);
  return context;
}
