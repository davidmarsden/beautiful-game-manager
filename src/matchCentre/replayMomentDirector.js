const text = (value) => String(value ?? '').trim();
const normal = (value) => text(value).toLowerCase().replace(/[\s-]+/g, '_');
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const eventType = (event = {}) => normal(event.event_type || event.type || event.kind);
const eventSubtype = (event = {}) => normal(event.subtype || event.event_subtype || event.payload?.subtype);
const sequenceId = (event = {}) => text(event.sequence_id || event.payload?.sequence_id) || null;
const sequenceOrder = (event = {}) => Number.isFinite(Number(event.sequence_order ?? event.payload?.sequence_order))
  ? Number(event.sequence_order ?? event.payload?.sequence_order)
  : 50;

function bookingKey(event = {}) {
  const playerId = text(event.player_id || event.tbg_player_id || event.id);
  if (playerId) return `id:${playerId}`;
  const playerName = text(event.player_name || event.name).toLowerCase();
  return playerName ? `name:${normal(event.side)}:${playerName}` : null;
}

function goalSequenceIds(events = []) {
  return new Set(events
    .filter((event) => ['goal', 'penalty_scored'].includes(eventType(event)))
    .map(sequenceId)
    .filter(Boolean));
}

function sameMinuteBucket(event, goalSequences) {
  const type = eventType(event);
  const seq = sequenceId(event);
  if (seq && goalSequences.has(seq)) return 0;
  if (type === 'goal' || type === 'penalty_scored') return 0;
  if (type === 'red_card' || type === 'second_yellow') return 1;
  if (type.startsWith('penalty_') || type === 'penalty_awarded') return 1;
  if (type === 'substitution') return 3;
  return 2;
}

export function orderReplayEvents(events = []) {
  const goals = goalSequenceIds(events);
  return events.map((event, index) => ({ event, index })).sort((left, right) => {
    const minute = number(left.event.minute) - number(right.event.minute);
    if (minute) return minute;
    const bucket = sameMinuteBucket(left.event, goals) - sameMinuteBucket(right.event, goals);
    if (bucket) return bucket;
    const leftSeq = sequenceId(left.event);
    const rightSeq = sequenceId(right.event);
    if (leftSeq && rightSeq && leftSeq === rightSeq) {
      const sequence = sequenceOrder(left.event) - sequenceOrder(right.event);
      if (sequence) return sequence;
    }
    return left.index - right.index;
  }).map(({ event }) => event);
}

function chanceBand(event = {}) {
  const xg = number(event.xg ?? event.payload?.xg, -1);
  if (xg < 0) return 'unknown';
  if (xg <= 0.08) return 'very_low';
  if (xg <= 0.18) return 'low';
  if (xg >= 0.5) return 'close';
  if (xg >= 0.3) return 'good';
  return 'medium';
}

function attemptCommentary(event, playerName) {
  const player = playerName || text(event.player_name) || 'The attacker';
  const origin = normal(event.chance_origin || event.payload?.chance_origin);
  const band = chanceBand(event);

  // The attempt must never reveal its outcome. Save/miss/goal belongs to the next replay beat.
  if (origin === 'corner') {
    if (band === 'very_low' || band === 'low') return `${player} attacks the corner and gets a difficult effort away.`;
    if (band === 'close' || band === 'good') return `${player} meets the corner with a powerful effort.`;
    return `${player} gets to the corner first and directs an effort towards goal.`;
  }
  if (origin === 'free_kick') return `${player} meets the free-kick delivery and sends an effort towards goal.`;
  if (band === 'very_low') return `${player} lets fly from distance.`;
  if (band === 'low') return `${player} drives a fierce effort towards goal.`;
  if (band === 'close') return `${player} gets a close-range effort away.`;
  if (band === 'good') return `${player} gets a clear sight of goal and shoots.`;
  return `${player} gets a clean strike away.`;
}

function outcomePresentation(outcome) {
  const key = normal(outcome);
  if (key === 'saved') return { display_event_type: 'chance_saved', label: 'SAVED', commentary: 'But the goalkeeper gets across to make the save.' };
  if (key === 'missed') return { display_event_type: 'chance_missed', label: 'WIDE', commentary: 'But the effort goes wide.' };
  if (key === 'woodwork') return { display_event_type: 'chance_woodwork', label: 'OFF THE WOODWORK', commentary: 'It crashes back off the woodwork!' };
  if (key === 'offside') return { display_event_type: 'chance_offside', label: 'OFFSIDE', commentary: 'But the flag is up — offside.' };
  return null;
}

function chancePresentation(event, overrides = {}) {
  return {
    importance: 'featured',
    major: true,
    kind: overrides.kind || 'chance',
    label: overrides.label || 'CHANCE',
    hold_ms: overrides.hold_ms ?? 1800,
    priority: overrides.priority ?? 92,
    sequence_id: sequenceId(event),
    sequence_order: overrides.sequence_order ?? sequenceOrder(event),
    sequence_role: overrides.sequence_role || 'build_up'
  };
}

function outcomeRevealEvent(attempt) {
  const outcome = normal(attempt.outcome || attempt.payload?.outcome);
  if (outcome === 'goal') return null;
  const reveal = outcomePresentation(outcome);
  if (!reveal) return null;
  return {
    minute: attempt.minute,
    side: attempt.side,
    event_type: 'chance_outcome',
    display_event_type: reveal.display_event_type,
    player_id: attempt.player_id,
    player_name: attempt.player_name,
    event_id: `${text(attempt.event_id) || `chance-${attempt.minute}`}:outcome`,
    source_event_id: attempt.event_id || null,
    sequence_id: sequenceId(attempt),
    sequence_order: sequenceOrder(attempt) + 1,
    display_only: true,
    commentary: reveal.commentary,
    replay_presentation: chancePresentation(attempt, {
      kind: 'chance-outcome',
      label: reveal.label,
      hold_ms: 1800,
      priority: 94,
      sequence_order: sequenceOrder(attempt) + 1,
      sequence_role: 'outcome'
    })
  };
}

function goalCommentary(goal, attempt, scorerName, clubName) {
  const player = scorerName || text(goal.player_name) || 'The scorer';
  const club = clubName || (normal(goal.side) === 'home' ? 'the home side' : 'the away side');
  const origin = normal(goal.chance_origin || goal.payload?.chance_origin || attempt?.chance_origin || attempt?.payload?.chance_origin);
  const band = chanceBand(attempt || goal);

  if (origin === 'corner') {
    if (band === 'very_low' || band === 'low') return `GOAL! ${player} turns the corner into a superb finish for ${club}.`;
    return `GOAL! ${player} powers the corner home for ${club}.`;
  }
  if (origin === 'free_kick') return `GOAL! ${player} finishes the move from the free kick for ${club}.`;
  if (band === 'very_low') return `GOAL! ${player} scores with a superb strike from distance for ${club}.`;
  if (band === 'low') return `GOAL! ${player} finds the net with a superb strike for ${club}.`;
  if (band === 'close') return `GOAL! ${player} turns it in from close range for ${club}.`;
  return `GOAL! ${player} finishes emphatically for ${club}.`;
}

function findSequenceAttempt(events, goal) {
  const source = text(goal.source_event_id || goal.parent_event_id || goal.payload?.source_event_id);
  if (source) {
    const direct = events.find((event) => text(event.event_id) === source);
    if (direct) return direct;
  }
  const seq = sequenceId(goal);
  if (!seq) return null;
  return events.find((event) => sequenceId(event) === seq && ['shot', 'big_chance'].includes(eventType(event))) || null;
}

function stageChanceBuildUps(events) {
  const chanceSequences = new Set(events
    .filter((event) => ['shot', 'big_chance'].includes(eventType(event)))
    .map(sequenceId)
    .filter(Boolean));
  for (const event of events) {
    const seq = sequenceId(event);
    if (!seq || !chanceSequences.has(seq)) continue;
    const type = eventType(event);
    const subtype = eventSubtype(event);
    if (type === 'set_piece' && subtype === 'corner') {
      event.replay_presentation = chancePresentation(event, { kind: 'build-up', label: 'CORNER', hold_ms: 1400, priority: 88, sequence_role: 'source' });
    } else if (type === 'free_kick' || (type === 'set_piece' && subtype === 'free_kick')) {
      event.replay_presentation = chancePresentation(event, { kind: 'build-up', label: 'FREE KICK', hold_ms: 1400, priority: 88, sequence_role: 'source' });
    }
  }
}

export function enrichReplayCommentary(events = [], clubs = {}) {
  const ordered = events.map((event) => ({ ...event }));
  const byPlayer = new Map();
  for (const event of ordered) {
    const key = text(event.player_id);
    const name = text(event.player_name);
    if (key && name) byPlayer.set(key, name);
  }

  const explicitSecondYellow = new Set(ordered
    .filter((event) => eventType(event) === 'second_yellow'
      || (eventType(event) === 'red_card' && eventSubtype(event) === 'second_yellow'))
    .map(bookingKey)
    .filter(Boolean));
  const bookings = new Map();

  for (const event of ordered) {
    const type = eventType(event);
    if (type === 'yellow_card') {
      const key = bookingKey(event);
      if (key) {
        const count = (bookings.get(key) || 0) + 1;
        bookings.set(key, count);
        if (count >= 2 && !explicitSecondYellow.has(key)) {
          const player = text(event.player_name) || byPlayer.get(text(event.player_id)) || 'The player';
          event.commentary = `${player} is shown a second yellow card and is sent off.`;
          event.display_event_type = 'second_yellow';
        }
      }
    }
    if (type === 'second_yellow' || (type === 'red_card' && eventSubtype(event) === 'second_yellow')) {
      const player = text(event.player_name) || byPlayer.get(text(event.player_id)) || 'The player';
      event.commentary = `${player} is sent off after receiving a second yellow card.`;
      event.display_event_type = 'second_yellow';
    }
  }

  stageChanceBuildUps(ordered);

  const goalsBySequence = new Map(ordered
    .filter((event) => eventType(event) === 'goal' && sequenceId(event))
    .map((event) => [sequenceId(event), event]));
  const expanded = [];
  for (const event of ordered) {
    const type = eventType(event);
    if (['shot', 'big_chance'].includes(type)) {
      const player = text(event.player_name) || byPlayer.get(text(event.player_id)) || 'The attacker';
      event.commentary = attemptCommentary(event, player);
      event.display_event_type = 'chance_attempt';
      event.replay_presentation = chancePresentation(event, { kind: 'chance', label: 'CHANCE', hold_ms: 1800, priority: 92, sequence_role: 'build_up' });
      expanded.push(event);
      const linkedGoal = sequenceId(event) && goalsBySequence.has(sequenceId(event));
      if (!linkedGoal) {
        const reveal = outcomeRevealEvent(event);
        if (reveal) expanded.push(reveal);
      }
      continue;
    }
    expanded.push(event);
  }

  for (const goal of expanded.filter((event) => eventType(event) === 'goal')) {
    const attempt = findSequenceAttempt(expanded, goal);
    const isOwnGoal = goal.own_goal === true || goal.payload?.own_goal === true;
    if (isOwnGoal) {
      const defenderId = text(goal.own_goal_player_id || goal.payload?.own_goal_player_id);
      const defender = text(goal.own_goal_player_name || goal.payload?.own_goal_player_name)
        || byPlayer.get(defenderId);
      if (defender) goal.commentary = `${defender} turns the ball into their own net.`;
      else if (!text(goal.commentary || goal.payload?.commentary)) goal.commentary = 'A defender turns the ball into their own net.';
      continue;
    }
    const scorer = text(goal.player_name) || byPlayer.get(text(goal.player_id)) || text(attempt?.player_name) || byPlayer.get(text(attempt?.player_id)) || 'The scorer';
    const club = text(clubs?.[goal.side]) || text(goal.club_name);
    goal.commentary = goalCommentary(goal, attempt, scorer, club);
  }

  return expanded;
}

export function cardSummaryFromEvents(events = [], side) {
  const rows = [];
  const bookings = new Map();
  const secondYellowKeys = new Set(events
    .filter((event) => eventType(event) === 'second_yellow'
      || (eventType(event) === 'red_card' && eventSubtype(event) === 'second_yellow'))
    .map(bookingKey)
    .filter(Boolean));
  const representedSecondYellow = new Set();

  for (const event of events) {
    if (normal(event.side) !== normal(side)) continue;
    const type = eventType(event);
    const key = bookingKey(event);
    if (type === 'yellow_card') {
      const count = key ? (bookings.get(key) || 0) + 1 : 1;
      if (key) bookings.set(key, count);
      const second = count >= 2;
      if (second && key) representedSecondYellow.add(key);
      rows.push({
        ...event,
        event_type: second ? 'second_yellow' : 'yellow_card',
        card_reason: second ? 'second_yellow' : 'booking'
      });
      continue;
    }
    if (type === 'second_yellow') {
      if (key && representedSecondYellow.has(key)) continue;
      if (key) representedSecondYellow.add(key);
      rows.push({ ...event, event_type: 'second_yellow', card_reason: 'second_yellow' });
      continue;
    }
    if (type === 'red_card') {
      if (eventSubtype(event) === 'second_yellow' && key && (representedSecondYellow.has(key) || secondYellowKeys.has(key))) continue;
      rows.push({ ...event, event_type: 'red_card', card_reason: eventSubtype(event) || 'straight_red' });
    }
  }
  return rows;
}
