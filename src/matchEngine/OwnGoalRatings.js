const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const roundRating = (value) => Math.round((value + Number.EPSILON) * 10) / 10;

const OWN_GOAL_PENALTY = 1.15;
const OPEN_PLAY_GOAL_REWARD = 1.15;

function ownGoalAdjustments(resolution = {}) {
  const penalties = new Map();
  const falseRewards = new Map();
  const score = { home: 0, away: 0 };

  for (const event of resolution.official_event_stream || []) {
    if (event.type !== 'goal') continue;
    const side = event.side;
    const opponent = side === 'home' ? 'away' : 'home';
    const beforeState = Math.sign(score[side] - score[opponent]);
    score[side] += 1;
    const afterState = Math.sign(score[side] - score[opponent]);

    if (event.own_goal !== true) continue;

    const defenderId = event.own_goal_player_id ? String(event.own_goal_player_id) : null;
    if (defenderId) penalties.set(defenderId, (penalties.get(defenderId) || 0) + OWN_GOAL_PENALTY);

    const attackingActorId = event.player_id ? String(event.player_id) : null;
    if (attackingActorId) {
      const decisiveContext = afterState > beforeState ? (number(event.minute) >= 75 ? 0.2 : 0.1) : 0;
      const current = falseRewards.get(attackingActorId) || { goal: 0, context: 0 };
      current.goal += OPEN_PLAY_GOAL_REWARD;
      current.context += decisiveContext;
      falseRewards.set(attackingActorId, current);
    }
  }

  return { penalties, falseRewards };
}

function reconcileRows(rows = [], adjustments) {
  return rows.map((row) => {
    if (row.rating === null) return row;
    const playerId = String(row.player_id);
    const penalty = adjustments.penalties.get(playerId) || 0;
    const falseReward = adjustments.falseRewards.get(playerId) || { goal: 0, context: 0 };
    if (!penalty && !falseReward.goal && !falseReward.context) return row;

    const totalAdjustment = penalty + falseReward.goal + falseReward.context;
    const eventImpact = number(row.components?.event_impact) - falseReward.goal - penalty;
    const matchContext = clamp(number(row.components?.match_context) - falseReward.context, -0.25, 0.25);
    const ownGoalCount = penalty ? Math.round(penalty / OWN_GOAL_PENALTY) : 0;
    return {
      ...row,
      rating: roundRating(clamp(number(row.rating) - totalAdjustment, 1, 10)),
      components: row.components ? {
        ...row.components,
        event_impact: Number(eventImpact.toFixed(3)),
        match_context: Number(matchContext.toFixed(3))
      } : row.components,
      highlights: ownGoalCount
        ? [...(row.highlights || []).filter((label) => !/^\d+ goals?$/.test(label)), `${ownGoalCount} own goal${ownGoalCount === 1 ? '' : 's'}`]
        : (row.highlights || []).filter((label) => !/^\d+ goals?$/.test(label))
    };
  }).sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || String(left.player_id).localeCompare(String(right.player_id)));
}

export function reconcileOwnGoalRatings(ratings, resolution) {
  if (!ratings?.deterministic) return ratings;
  const adjustments = ownGoalAdjustments(resolution);
  if (!adjustments.penalties.size && !adjustments.falseRewards.size) return ratings;
  const home = reconcileRows(ratings.home, adjustments);
  const away = reconcileRows(ratings.away, adjustments);
  const rated = [...home, ...away].filter((row) => row.rating !== null)
    .sort((a, b) => b.rating - a.rating || b.minutes_played - a.minutes_played || String(a.player_id).localeCompare(String(b.player_id)));
  return {
    ...ratings,
    version: `${ratings.version}+own-goal-v0.2`,
    home,
    away,
    player_of_the_match: rated[0] || null
  };
}
