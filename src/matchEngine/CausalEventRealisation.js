const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const CAUSAL_EVENT_REALISATION_VERSION = 'tbg-causal-event-realisation-v0.2';

function stableUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function attackingAttempt(event) {
  return ['shot', 'big_chance', 'goal'].includes(text(event?.type)) && text(event?.subtype) !== 'penalty_goal';
}

function defenderPool(quality = {}, side) {
  const rows = quality?.[side]?.starters || [];
  const defenders = rows.filter((player) => ['cb', 'fb', 'wing_back', 'dm'].includes(text(player.required_role)));
  return defenders.length ? defenders : rows.filter((player) => text(player.required_role) !== 'gk');
}

function ownGoalDefender(quality, defendingSide, key) {
  const pool = defenderPool(quality, defendingSide);
  if (!pool.length) return null;
  return pool[Math.floor(stableUnit(`${key}:defender`) * pool.length)] || pool[0] || null;
}

function chanceSequence(event, quality) {
  const side = text(event.side);
  const defendingSide = side === 'home' ? 'away' : 'home';
  const sequenceId = `sequence-${event.event_id}`;
  const attemptId = `${sequenceId}-10-attempt`;
  const originalType = text(event.type);
  const outcome = originalType === 'goal'
    ? 'goal'
    : text(event.outcome) === 'saved' || event.on_target === true
      ? 'saved'
      : stableUnit(`${event.event_id}:offside`) < 0.06
        ? 'offside'
        : stableUnit(`${event.event_id}:woodwork`) < 0.08
          ? 'woodwork'
          : 'missed';
  const attempt = {
    ...event,
    event_id: attemptId,
    sequence_id: sequenceId,
    sequence_order: 10,
    type: number(event.xg, 0) >= 0.22 ? 'big_chance' : 'shot',
    subtype: 'attempt',
    outcome,
    on_target: outcome === 'goal' || outcome === 'saved',
    linked_event_id: outcome === 'goal' ? `${sequenceId}-20-goal` : null,
    commentary_hook: outcome === 'saved' ? 'shot_on_target' : number(event.xg, 0) >= 0.22 ? 'big_chance' : 'shot'
  };
  if (outcome !== 'goal') return { sequenceId, attempt, goal: null };

  const ownGoal = stableUnit(`${event.event_id}:own-goal`) < 0.035;
  const defender = ownGoal ? ownGoalDefender(quality, defendingSide, event.event_id) : null;
  const goal = {
    ...event,
    event_id: `${sequenceId}-20-goal`,
    sequence_id: sequenceId,
    sequence_order: 20,
    type: 'goal',
    subtype: defender ? 'own_goal' : 'open_play_goal',
    side,
    against_side: defendingSide,
    player_id: event.player_id || null,
    own_goal_player_id: defender?.player_id || null,
    source_event_id: attemptId,
    parent_event_id: attemptId,
    linked_event_id: null,
    xg: 0,
    on_target: true,
    outcome: 'goal',
    own_goal: Boolean(defender),
    beneficiary_player_id: defender ? event.player_id || null : null,
    commentary_hook: 'goal'
  };
  return { sequenceId, attempt, goal };
}

function setPieceShouldLeadToAttempt(event) {
  const subtype = text(event.subtype);
  const threshold = subtype === 'free_kick' ? 0.68 : subtype === 'corner' ? 0.36 : 0;
  return stableUnit(`${event.event_id}:attempt`) < threshold;
}

function attachSetPieces(setPieces, sequences) {
  const availableBySide = {
    home: sequences.filter((sequence) => text(sequence.attempt.side) === 'home' && !sequence.sourceSetPiece),
    away: sequences.filter((sequence) => text(sequence.attempt.side) === 'away' && !sequence.sourceSetPiece)
  };
  const cursors = { home: 0, away: 0 };
  const output = [];
  for (const setPiece of setPieces) {
    const side = text(setPiece.side);
    const available = availableBySide[side] || [];
    const cursor = cursors[side] || 0;
    if (!setPieceShouldLeadToAttempt(setPiece) || cursor >= available.length) {
      output.push({ ...setPiece, sequence_id: `sequence-${setPiece.event_id}`, sequence_order: 0 });
      continue;
    }
    const sequence = available[cursor];
    cursors[side] = cursor + 1;
    sequence.sourceSetPiece = setPiece;
    const sourceId = `${sequence.sequenceId}-00-set-piece`;
    output.push({
      ...setPiece,
      event_id: sourceId,
      minute: sequence.attempt.minute,
      sequence_id: sequence.sequenceId,
      sequence_order: 0,
      linked_event_id: sequence.attempt.event_id
    });
    sequence.attempt = {
      ...sequence.attempt,
      parent_event_id: sourceId,
      source_event_id: sourceId,
      chance_origin: text(setPiece.subtype)
    };
    if (sequence.goal) sequence.goal = { ...sequence.goal, chance_origin: text(setPiece.subtype) };
  }
  return output;
}

function penaltyRoot(eventId) {
  const match = String(eventId || '').match(/^(.*-penalty-\d+)/);
  return match?.[1] || null;
}

function canonicalPenaltyOrder(event) {
  if (text(event.type) === 'foul') return 0;
  if (text(event.type) === 'penalty' && text(event.subtype) === 'penalty_awarded') return 10;
  if (text(event.type) === 'penalty' && text(event.subtype) === 'penalty_attempt') return 20 + 10 * Math.max(0, number(event.attempt_number, 1) - 1);
  if (text(event.type) === 'goal' && text(event.subtype) === 'penalty_goal') return 90;
  return 99;
}

function normalisePenaltyIncidents(events) {
  const groups = new Map();
  const untouched = [];
  for (const event of events) {
    const root = penaltyRoot(event.event_id);
    if (!root) { untouched.push(event); continue; }
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(event);
  }
  const normalised = [];
  for (const [root, rows] of groups) {
    const award = rows.find((event) => text(event.type) === 'penalty' && text(event.subtype) === 'penalty_awarded');
    const minute = number(award?.minute, Math.min(...rows.map((event) => number(event.minute, 120))));
    const mapping = new Map();
    for (const row of rows) mapping.set(row.event_id, `sequence-${root}-${String(canonicalPenaltyOrder(row)).padStart(2, '0')}-${text(row.type)}${row.attempt_number ? `-${row.attempt_number}` : ''}`);
    for (const row of rows) {
      normalised.push({
        ...row,
        event_id: mapping.get(row.event_id),
        minute,
        sequence_id: `sequence-${root}`,
        sequence_order: canonicalPenaltyOrder(row),
        source_event_id: mapping.get(row.source_event_id) || row.source_event_id || null,
        parent_event_id: mapping.get(row.parent_event_id) || row.parent_event_id || null,
        linked_event_id: mapping.get(row.linked_event_id) || row.linked_event_id || null
      });
    }
  }
  return [...untouched, ...normalised];
}

function canonicalOrder(events) {
  return [...events].sort((left, right) => {
    const minute = number(left.minute) - number(right.minute);
    if (minute) return minute;
    const leftSequence = String(left.sequence_id || left.event_id || '');
    const rightSequence = String(right.sequence_id || right.event_id || '');
    const sequence = leftSequence.localeCompare(rightSequence);
    if (sequence) return sequence;
    return number(left.sequence_order, 50) - number(right.sequence_order, 50) || String(left.event_id).localeCompare(String(right.event_id));
  });
}

function commentaryHooks(events, limit = 12) {
  const priority = { goal: 8, red_card: 7, penalty: 6, injury: 5, foul: 3, big_chance: 3, yellow_card: 2, set_piece: 1, shot: 0 };
  return events.filter((event) => event.commentary_hook)
    .sort((left, right) => (priority[text(right.type)] || 0) - (priority[text(left.type)] || 0) || number(left.minute) - number(right.minute))
    .slice(0, limit)
    .map((event) => ({ minute: event.minute, side: event.side, hook: event.commentary_hook, event_id: event.event_id }));
}

export function realiseCausalEventGeneration(eventGeneration, quality = {}) {
  if (!eventGeneration?.provisional_event_stream) return eventGeneration;
  const rawEvents = eventGeneration.provisional_event_stream;
  const chanceRows = rawEvents.filter((event) => attackingAttempt(event) && text(event.subtype) !== 'penalty_goal');
  const setPieces = rawEvents.filter((event) => text(event.type) === 'set_piece');
  const otherRows = rawEvents.filter((event) => !chanceRows.includes(event) && !setPieces.includes(event));
  const sequences = chanceRows.map((event) => chanceSequence(event, quality));
  const causalSetPieces = attachSetPieces(setPieces, sequences);
  const chanceEvents = sequences.flatMap((sequence) => [sequence.attempt, sequence.goal].filter(Boolean));
  const events = canonicalOrder(normalisePenaltyIncidents([...otherRows, ...causalSetPieces, ...chanceEvents]));
  return {
    ...eventGeneration,
    version: CAUSAL_EVENT_REALISATION_VERSION,
    provisional_event_stream: events,
    provisional_score: events.reduce((score, event) => {
      if (text(event.type) === 'goal') score[text(event.side)] += 1;
      return score;
    }, { home: 0, away: 0 }),
    commentary_hooks: commentaryHooks(events),
    event_counts: {
      ...(eventGeneration.event_counts || {}),
      total: events.length,
      chances: events.filter((event) => ['shot', 'big_chance'].includes(text(event.type)) || (text(event.type) === 'penalty' && text(event.subtype) === 'penalty_attempt' && text(event.outcome) !== 'retake')).length,
      goals: events.filter((event) => text(event.type) === 'goal').length,
      own_goals: events.filter((event) => text(event.type) === 'goal' && event.own_goal === true).length,
      causal_sequences: new Set(events.map((event) => event.sequence_id).filter(Boolean)).size
    },
    causal_event_model: true
  };
}

export function reconcileCausalResolution(resolution) {
  if (!resolution?.official_event_stream) return resolution;
  const linkedOpenPlayGoals = { home: 0, away: 0 };
  for (const event of resolution.official_event_stream) {
    if (text(event.type) === 'goal' && text(event.subtype) !== 'penalty_goal' && event.source_event_id) linkedOpenPlayGoals[text(event.side)] += 1;
  }
  const statistics = {};
  for (const side of ['home', 'away']) {
    const stats = resolution.statistics?.[side] || {};
    const duplicateGoalShot = linkedOpenPlayGoals[side];
    statistics[side] = {
      ...stats,
      shots: Math.max(0, number(stats.shots) - duplicateGoalShot),
      shots_on_target: Math.max(0, number(stats.shots_on_target) - duplicateGoalShot)
    };
  }
  return {
    ...resolution,
    version: `${resolution.version}+causal-v0.2`,
    statistics,
    consistency: { ...(resolution.consistency || {}), causal_attempts_linked: true, set_piece_sequences_atomic: true, set_piece_side_integrity: true, own_goal_defender_preserved: true, shot_totals_reconciled_after_goal_linking: true }
  };
}

export function reconcileOwnGoalCommentary(report, resolution, quality = {}) {
  if (!report?.commentary || !resolution?.official_event_stream) return report;
  const byEvent = new Map(resolution.official_event_stream.map((event) => [String(event.event_id), event]));
  const names = new Map();
  for (const side of ['home', 'away']) for (const player of quality?.[side]?.starters || []) names.set(String(player.player_id), player.display_name || player.player_id);
  return {
    ...report,
    version: `${report.version}+causal-v0.2`,
    commentary: report.commentary.map((row) => {
      const event = byEvent.get(String(row.event_id));
      if (!event?.own_goal) return row;
      const defender = names.get(String(event.own_goal_player_id)) || 'A defender';
      return { ...row, text: `${defender} turns the ball into their own net.` };
    })
  };
}
