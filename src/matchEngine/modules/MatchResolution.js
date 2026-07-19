import { resolveLineupEvents } from '../LineupResolution.js';

const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const MATCH_RESOLUTION_VERSION = 'tbg-match-resolution-v0.5';
export const MATCH_RESOLUTION_STATE_KEY = 'module_e_match_resolution';

const ALLOWED_EVENT_TYPES = new Set([
  'shot', 'big_chance', 'goal', 'set_piece', 'penalty', 'foul', 'substitution',
  'yellow_card', 'red_card', 'injury'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isPenaltyAttempt(event) { return event.type === 'penalty' && event.subtype === 'penalty_attempt'; }
function isPenaltyGoal(event) { return event.type === 'goal' && event.subtype === 'penalty_goal'; }

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
  if (type === 'substitution') {
    if (!String(event?.player_out_id || '').trim() || !String(event?.player_in_id || '').trim()) throw new Error(`Module E substitution is missing player identity: ${eventId}`);
    if (String(event.player_out_id) === String(event.player_in_id)) throw new Error(`Module E substitution cannot replace a player with themselves: ${eventId}`);
  }
  if (isPenaltyAttempt({ ...event, type, subtype: text(event?.subtype) }) && !['goal', 'saved', 'missed', 'retake'].includes(text(event?.outcome))) {
    throw new Error(`Module E penalty attempt has invalid outcome: ${eventId}`);
  }
  return deepFreeze({ ...event, event_id: eventId, side, type, subtype: event?.subtype ? text(event.subtype) : null, outcome: event?.outcome ? text(event.outcome) : null, minute, provisional: false, official: true });
}

function orderEvents(events) { return events.sort((left, right) => left.minute - right.minute || left.event_id.localeCompare(right.event_id)); }

function validateLinks(events) {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const awards = events.filter((event) => event.type === 'penalty' && event.subtype === 'penalty_awarded');
  const attempts = events.filter(isPenaltyAttempt);
  const penaltyGoals = events.filter(isPenaltyGoal);
  for (const awarded of awards) {
    const foul = byId.get(awarded.source_event_id); const attempt = byId.get(awarded.linked_event_id);
    if (!foul || foul.type !== 'foul' || foul.subtype !== 'penalty_foul') throw new Error(`Module E penalty award is missing its source foul: ${awarded.event_id}`);
    if (!attempt || !isPenaltyAttempt(attempt)) throw new Error(`Module E penalty award is missing its attempt: ${awarded.event_id}`);
    if (attempt.parent_event_id !== awarded.event_id || attempt.source_event_id !== foul.event_id) throw new Error(`Module E penalty linkage is inconsistent: ${awarded.event_id}`);
    if (foul.linked_event_id !== awarded.event_id) throw new Error(`Module E penalty foul linkage is inconsistent: ${foul.event_id}`);
  }
  for (const attempt of attempts) {
    const parent = byId.get(attempt.parent_event_id);
    if (!parent) throw new Error(`Module E penalty attempt is orphaned: ${attempt.event_id}`);
    const parentIsAward = parent.type === 'penalty' && parent.subtype === 'penalty_awarded';
    const parentIsRetake = isPenaltyAttempt(parent) && parent.outcome === 'retake';
    if (!parentIsAward && !parentIsRetake) throw new Error(`Module E penalty attempt has invalid parent: ${attempt.event_id}`);
    if (parent.linked_event_id !== attempt.event_id) throw new Error(`Module E penalty attempt parent linkage is inconsistent: ${attempt.event_id}`);
    if (parentIsRetake && attempt.source_event_id !== parent.source_event_id) throw new Error(`Module E penalty retake source linkage is inconsistent: ${attempt.event_id}`);
    if (attempt.outcome === 'retake') {
      const nextAttempt = byId.get(attempt.linked_event_id);
      if (!nextAttempt || !isPenaltyAttempt(nextAttempt)) throw new Error(`Module E penalty retake is missing its next attempt: ${attempt.event_id}`);
      if (nextAttempt.parent_event_id !== attempt.event_id) throw new Error(`Module E penalty retake linkage is inconsistent: ${attempt.event_id}`);
    } else if (attempt.outcome === 'goal') {
      const goal = byId.get(attempt.linked_event_id);
      if (!goal || !isPenaltyGoal(goal)) throw new Error(`Module E scored penalty is missing its goal event: ${attempt.event_id}`);
      if (goal.source_event_id !== attempt.event_id || goal.parent_event_id !== attempt.event_id) throw new Error(`Module E scored penalty goal linkage is inconsistent: ${attempt.event_id}`);
      if (goal.side !== attempt.side || goal.player_id !== attempt.player_id) throw new Error(`Module E scored penalty goal identity is inconsistent: ${attempt.event_id}`);
    } else if (attempt.linked_event_id) throw new Error(`Module E terminal penalty attempt has an unexpected linked event: ${attempt.event_id}`);
  }
  for (const goal of penaltyGoals) {
    const attempt = byId.get(goal.source_event_id);
    if (!attempt || !isPenaltyAttempt(attempt) || attempt.outcome !== 'goal') throw new Error(`Module E penalty goal is orphaned: ${goal.event_id}`);
    if (attempt.linked_event_id !== goal.event_id) throw new Error(`Module E penalty goal linkage is inconsistent: ${goal.event_id}`);
  }
}

function dismissalStatistics(events) {
  const explicitRedCards = events.filter((event) => event.type === 'red_card');
  const explicitlyDismissedPlayers = new Set(explicitRedCards.filter((event) => event.player_id).map((event) => String(event.player_id)));
  const yellowCardsByPlayer = new Map();
  for (const event of events.filter((row) => row.type === 'yellow_card' && row.player_id)) yellowCardsByPlayer.set(String(event.player_id), (yellowCardsByPlayer.get(String(event.player_id)) || 0) + 1);
  const secondYellowDismissals = [...yellowCardsByPlayer.entries()].filter(([playerId, count]) => count >= 2 && !explicitlyDismissedPlayers.has(playerId)).length;
  return deepFreeze({ red_cards: explicitRedCards.length + secondYellowDismissals, straight_red_cards: explicitRedCards.length, second_yellow_dismissals: secondYellowDismissals });
}

function sideStatistics(side, events, expected) {
  const own = events.filter((event) => event.side === side);
  const terminalPenaltyAttempts = own.filter((event) => isPenaltyAttempt(event) && event.outcome !== 'retake');
  const openPlayShots = own.filter((event) => ['shot', 'big_chance'].includes(event.type) || (event.type === 'goal' && !isPenaltyGoal(event)));
  const shots = [...openPlayShots, ...terminalPenaltyAttempts];
  const onTarget = shots.filter((event) => event.on_target === true || event.type === 'goal');
  const goals = own.filter((event) => event.type === 'goal');
  const yellowCards = own.filter((event) => event.type === 'yellow_card');
  const dismissals = dismissalStatistics(own);
  const penaltiesAwarded = own.filter((event) => event.type === 'penalty' && event.subtype === 'penalty_awarded');
  const penaltyAttempts = own.filter(isPenaltyAttempt);
  const foulsCommitted = own.filter((event) => event.type === 'foul');
  const substitutions = own.filter((event) => event.type === 'substitution');
  const generatedXg = shots.reduce((sum, event) => sum + number(event.xg, 0), 0);
  return deepFreeze({
    goals: goals.length, shots: shots.length, shots_on_target: onTarget.length,
    big_chances: own.filter((event) => event.type === 'big_chance' || (event.type === 'goal' && !isPenaltyGoal(event) && number(event.xg, 0) >= 0.22)).length + terminalPenaltyAttempts.length,
    expected_goals: round(generatedXg, 3), model_expected_goals: round(number(expected?.expected_goals, generatedXg), 3), generated_xg: round(generatedXg, 3),
    corners: own.filter((event) => event.type === 'set_piece' && event.subtype === 'corner').length,
    free_kicks: own.filter((event) => event.type === 'set_piece' && event.subtype === 'free_kick').length,
    fouls_committed: foulsCommitted.length, fouls_won: events.filter((event) => event.type === 'foul' && event.against_side === side).length,
    penalties_awarded: penaltiesAwarded.length, penalties_taken: terminalPenaltyAttempts.length, penalty_attempt_events: penaltyAttempts.length,
    penalty_retakes: penaltyAttempts.filter((event) => event.outcome === 'retake').length,
    penalties_scored: terminalPenaltyAttempts.filter((event) => event.outcome === 'goal').length,
    penalties_saved: terminalPenaltyAttempts.filter((event) => event.outcome === 'saved').length,
    penalties_missed: terminalPenaltyAttempts.filter((event) => event.outcome === 'missed').length,
    substitutions: substitutions.length, injury_substitutions: substitutions.filter((event) => event.reason === 'injury').length,
    yellow_cards: yellowCards.length, red_cards: dismissals.red_cards, straight_red_cards: dismissals.straight_red_cards,
    second_yellow_dismissals: dismissals.second_yellow_dismissals, injuries: own.filter((event) => event.type === 'injury').length
  });
}

function disciplinaryState(events) {
  const byPlayer = new Map();
  for (const event of events.filter((row) => ['yellow_card', 'red_card'].includes(row.type) && row.player_id)) {
    const key = String(event.player_id); const current = byPlayer.get(key) || { player_id: key, yellow_cards: 0, red_cards: 0 };
    if (event.type === 'yellow_card') current.yellow_cards += 1; if (event.type === 'red_card') current.red_cards += 1; byPlayer.set(key, current);
  }
  return [...byPlayer.values()].map((row) => deepFreeze({ ...row, sent_off: row.red_cards > 0 || row.yellow_cards >= 2, dismissal_type: row.red_cards > 0 ? 'straight_red' : row.yellow_cards >= 2 ? 'second_yellow' : null }));
}

function projectedStateChanges(events, fatigue, lineups, contract = {}) {
  const injuries = events.filter((event) => event.type === 'injury').map((event) => deepFreeze({ player_id: event.player_id, side: event.side, minute: event.minute, status: 'injury_assessment_required' }));
  const fitness = [];
  const fatigueByPlayer = new Map();
  for (const side of ['home', 'away']) for (const player of fatigue?.[side]?.players || []) fatigueByPlayer.set(String(player.player_id), { ...player, side });
  for (const side of ['home', 'away']) {
    const minuteRows = lineups?.[side]?.minutes_played || (fatigue?.[side]?.players || []).map((player) => ({ player_id: player.player_id, minutes: 90 }));
    for (const row of minuteRows) {
      const playerId = String(row.player_id); const fatiguePlayer = fatigueByPlayer.get(playerId);
      const persisted = contract?.match_state?.players?.[playerId] || {};
      const startingFitness = number(fatiguePlayer?.fitness, number(persisted.fitness, 100));
      const ninetyFitness = number(fatiguePlayer?.projected_post_match_fitness_90, startingFitness - 10);
      const loss = Math.max(0, startingFitness - ninetyFitness);
      const projected = clamp(startingFitness - loss * clamp(number(row.minutes, 0) / 90, 0, 1), 0, 100);
      fitness.push(deepFreeze({ player_id: playerId, side, minutes_played: number(row.minutes, 0), starting_fitness: startingFitness, projected_post_match_fitness: round(projected, 3) }));
    }
  }
  return deepFreeze({ fitness, injuries, discipline: disciplinaryState(events), lineup_state: lineups, persistence_pending: true });
}

export function resolveMatch(eventGeneration, fatigue = {}, options = {}) {
  if (!eventGeneration?.provisional_event_stream) throw new Error('Module E requires Module D event generation');
  const lineupResolution = resolveLineupEvents(eventGeneration, options.contract, options.quality);
  const seenIds = new Set();
  const events = orderEvents(lineupResolution.events.map((event) => validateEvent(event, seenIds)));
  validateLinks(events);
  const score = events.reduce((result, event) => { if (event.type === 'goal') result[event.side] += 1; return result; }, { home: 0, away: 0 });
  const expected = eventGeneration.expected || {};
  const statistics = deepFreeze({ home: sideStatistics('home', events, expected.home), away: sideStatistics('away', events, expected.away) });
  if (statistics.home.goals !== score.home || statistics.away.goals !== score.away) throw new Error('Module E score and event stream are inconsistent');
  return deepFreeze({
    version: MATCH_RESOLUTION_VERSION, seed_commitment: eventGeneration.seed_commitment || null, score,
    result: score.home > score.away ? 'home_win' : score.away > score.home ? 'away_win' : 'draw',
    official_event_stream: events, statistics, lineup_state: lineupResolution.lineups,
    state_changes: projectedStateChanges(events, fatigue, lineupResolution.lineups, options.contract),
    consistency: { unique_event_ids: true, chronological_events: true, score_matches_goals: true, statistics_reconciled: true, expected_goals_derived_from_official_shots: true, dismissals_reconciled: true, linked_penalties_reconciled: true, score_changes_are_goal_events: true, substitutions_reconciled: true, active_lineups_reconciled: true },
    resolution_complete: true, applied_to_public_result: false
  });
}

export function executeMatchResolution(context) {
  const result = resolveMatch(context.get('module_d_event_generation'), context.get('module_c_fatigue_context'), {
    contract: context.contract,
    quality: context.get('module_b_player_quality')
  });
  context.set(MATCH_RESOLUTION_STATE_KEY, result);
  return context;
}
