const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value) => String(value ?? '').trim().toLowerCase();
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, places = 3) => Number(Number(value).toFixed(places));

export const PERFORMANCE_RATINGS_VERSION = 'tbg-performance-ratings-v0.1';
export const PERFORMANCE_RATINGS_STATE_KEY = 'module_g_performance_ratings';

const ROLE_GROUP = Object.freeze({
  gk: 'goalkeeper', goalkeeper: 'goalkeeper',
  cb: 'defender', fb: 'defender', wing_back: 'defender', defender: 'defender',
  dm: 'midfielder', cm: 'midfielder', am: 'midfielder', wide_mid: 'midfielder', midfielder: 'midfielder',
  wing: 'attacker', st: 'attacker', forward: 'attacker', attacker: 'attacker'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function playerRole(player = {}, quality = null) {
  const explicit = text(quality?.required_role || quality?.actual_role);
  if (explicit && ROLE_GROUP[explicit]) return ROLE_GROUP[explicit];
  const position = text(player.position || player.primary_position || player.position_name || player.position_group || player.canonical_position);
  if (position.includes('goal')) return 'goalkeeper';
  if (position.includes('back') || position.includes('defend')) return 'defender';
  if (position.includes('mid')) return 'midfielder';
  if (position.includes('wing') || position.includes('forward') || position.includes('striker') || position.includes('attack')) return 'attacker';
  return 'unknown';
}

function lineupMinutes(resolution, side) {
  const rows = resolution.lineup_state?.[side]?.minutes_played || [];
  return new Map(rows.map((row) => [String(row.player_id), clamp(number(row.minutes, 0), 0, 120)]));
}

function sideQuality(quality, side) {
  const team = quality?.[side] || {};
  const rows = [...(team.starters || []), ...(team.bench?.players || [])];
  return new Map(rows.map((row) => [String(row.player_id), row]));
}

function scoreTimeline(events) {
  const score = { home: 0, away: 0 };
  const byEvent = new Map();
  for (const event of events) {
    if (event.type !== 'goal') continue;
    const before = { ...score };
    score[event.side] += 1;
    const after = { ...score };
    const opponent = event.side === 'home' ? 'away' : 'home';
    const beforeState = Math.sign(before[event.side] - before[opponent]);
    const afterState = Math.sign(after[event.side] - after[opponent]);
    const decisive = afterState > beforeState;
    const late = number(event.minute, 0) >= 75;
    byEvent.set(event.event_id, { decisive, late });
  }
  return byEvent;
}

function meaningfulEvent(event, playerId) {
  return event.player_id === playerId && ['goal', 'big_chance', 'penalty', 'yellow_card', 'red_card', 'injury'].includes(event.type)
    || event.assist_player_id === playerId;
}

function contributionForPlayer({ playerId, side, role, events, opponentGoalkeeperId, timeline }) {
  let outcomes = 0;
  let chance = 0;
  let defensive = 0;
  let possession = 0;
  let discipline = 0;
  let context = 0;
  const highlights = [];

  const own = events.filter((event) => event.player_id === playerId || event.assist_player_id === playerId);
  const goals = own.filter((event) => event.type === 'goal' && event.player_id === playerId);
  const assists = own.filter((event) => event.assist_player_id === playerId);
  const shots = own.filter((event) => ['shot', 'big_chance'].includes(event.type) && event.player_id === playerId);

  for (const event of own) {
    if (event.type === 'goal' && event.player_id === playerId) {
      const penalty = event.subtype === 'penalty_goal';
      outcomes += penalty ? 0.7 : 1.15;
      const state = timeline.get(event.event_id);
      if (state?.decisive) context += state.late ? 0.2 : 0.1;
    }
    if (event.assist_player_id === playerId) outcomes += 0.7;
    if (event.type === 'shot' && event.player_id === playerId) chance += event.on_target ? 0.08 : -0.05;
    if (event.type === 'big_chance' && event.player_id === playerId && event.outcome !== 'goal') chance -= 0.4;
    if (event.type === 'foul' && event.player_id === playerId) discipline -= event.subtype === 'penalty_foul' ? 0.65 : 0.04;
    if (event.type === 'yellow_card' && event.player_id === playerId) discipline -= 0.15;
    if (event.type === 'red_card' && event.player_id === playerId) discipline -= 1.25;
    if (event.type === 'penalty' && event.subtype === 'penalty_attempt' && event.player_id === playerId) {
      if (event.outcome === 'saved' || event.outcome === 'missed') outcomes -= 0.8;
    }
  }

  const saves = events.filter((event) => event.side !== side && ['shot', 'big_chance'].includes(event.type) && event.on_target === true && event.outcome !== 'goal').length;
  const penaltySaves = events.filter((event) => event.side !== side && event.type === 'penalty' && event.subtype === 'penalty_attempt' && event.outcome === 'saved').length;
  if (role === 'goalkeeper' && playerId === opponentGoalkeeperId) {
    defensive += Math.min(0.8, saves * 0.14) + penaltySaves * 1.25;
    if (saves) highlights.push(`${saves} save${saves === 1 ? '' : 's'}`);
    if (penaltySaves) highlights.push(`${penaltySaves} penalty saved`);
  }

  if (role === 'defender') {
    const goalsConceded = events.filter((event) => event.type === 'goal' && event.side !== side).length;
    defensive += goalsConceded === 0 ? 0.25 : -Math.min(0.32, goalsConceded * 0.08);
  }
  if (role === 'midfielder') possession += Math.min(0.25, assists.length * 0.1 + shots.length * 0.025);
  if (role === 'attacker') chance += Math.min(0.3, shots.length * 0.04);

  if (goals.length) highlights.push(`${goals.length} goal${goals.length === 1 ? '' : 's'}`);
  if (assists.length) highlights.push(`${assists.length} assist${assists.length === 1 ? '' : 's'}`);
  if (shots.filter((event) => event.type === 'big_chance' && event.outcome !== 'goal').length) highlights.push('major chance missed');
  if (own.some((event) => event.type === 'red_card' && event.player_id === playerId)) highlights.push('sent off');
  else if (own.some((event) => event.type === 'yellow_card' && event.player_id === playerId)) highlights.push('booked');

  return {
    outcomes: clamp(outcomes, -2, 2.5), chance: clamp(chance, -1, 1), defensive: clamp(defensive, -1, 1),
    possession: clamp(possession, -1, 1), discipline: clamp(discipline, -1.25, 0), context: clamp(context, -0.25, 0.25), highlights
  };
}

function resultAdjustment(resolution, side, quality) {
  const won = resolution.result === `${side}_win`;
  const lost = resolution.result !== 'draw' && !won;
  let adjustment = won ? 0.15 : lost ? -0.15 : 0;
  const ownStrength = number(quality?.[side]?.team_strength, 75);
  const otherSide = side === 'home' ? 'away' : 'home';
  const opponentStrength = number(quality?.[otherSide]?.team_strength, 75);
  const underdog = ownStrength + 2 < opponentStrength;
  const favourite = ownStrength > opponentStrength + 2;
  if (won && underdog) adjustment += 0.1;
  if (lost && favourite) adjustment -= 0.1;
  return clamp(adjustment, -0.25, 0.25);
}

function expectedAdjustment(qualityRow, minutes, realised) {
  const quality = number(qualityRow?.effective_quality, 75);
  const minuteShare = clamp(minutes / 90, 0, 1);
  const expected = (quality - 75) * 0.012 * minuteShare;
  const realisedTotal = realised.outcomes + realised.chance + realised.defensive + realised.possession;
  return clamp((realisedTotal - expected) * 0.22, -0.75, 0.75);
}

function rateSide(context, resolution, quality, side, timeline) {
  const minutes = lineupMinutes(resolution, side);
  const qualityById = sideQuality(quality, side);
  const players = context.playersById;
  const opponent = side === 'home' ? 'away' : 'home';
  const opponentGoalkeeperId = quality?.[side]?.starters?.find((row) => row.required_role === 'gk')?.player_id || null;
  const teamResult = resultAdjustment(resolution, side, quality);

  return [...minutes.entries()].map(([playerId, played]) => {
    const qualityRow = qualityById.get(playerId) || null;
    const player = players.get(playerId) || {};
    const role = playerRole(player, qualityRow);
    const realised = contributionForPlayer({ playerId, side, role, events: resolution.official_event_stream, opponentGoalkeeperId, timeline });
    const hasMeaningfulEvent = resolution.official_event_stream.some((event) => meaningfulEvent(event, playerId));
    if (played < 10 && !hasMeaningfulEvent) return deepFreeze({ player_id: playerId, side, minutes_played: played, role, rating: null, components: null, highlights: [] });

    const aboveExpectation = expectedAdjustment(qualityRow, played, realised);
    const roleContribution = clamp(realised.chance + realised.defensive + realised.possession, -1, 1);
    const raw = 6 + realised.outcomes + roleContribution + aboveExpectation + realised.context + teamResult + realised.discipline;
    const rating = round(clamp(raw, 1, 10), 1);
    return deepFreeze({
      player_id: playerId, side, minutes_played: played, role, rating,
      components: {
        baseline: 6, event_impact: round(realised.outcomes, 3), role_contribution: round(roleContribution, 3),
        above_expectation: round(aboveExpectation, 3), match_context: round(realised.context, 3),
        team_result: round(teamResult, 3), discipline: round(realised.discipline, 3)
      },
      highlights: realised.highlights
    });
  }).sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || left.player_id.localeCompare(right.player_id));
}

export function calculatePerformanceRatings(context) {
  const resolution = context.get('module_e_match_resolution');
  const quality = context.get('module_b_player_quality');
  if (!resolution?.resolution_complete) throw new Error('Module G requires Module E resolution');
  if (!quality?.home || !quality?.away) throw new Error('Module G requires Module B player quality');
  const timeline = scoreTimeline(resolution.official_event_stream || []);
  const home = rateSide(context, resolution, quality, 'home', timeline);
  const away = rateSide(context, resolution, quality, 'away', timeline);
  const rated = [...home, ...away].filter((row) => row.rating !== null).sort((a, b) => b.rating - a.rating || b.minutes_played - a.minutes_played || a.player_id.localeCompare(b.player_id));
  return deepFreeze({ version: PERFORMANCE_RATINGS_VERSION, home, away, player_of_the_match: rated[0] || null, rating_scale: { minimum: 1, neutral: 6, maximum: 10 }, deterministic: true });
}

export function executePerformanceRatings(context) {
  context.set(PERFORMANCE_RATINGS_STATE_KEY, calculatePerformanceRatings(context));
  return context;
}
