const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function ownGoalsByPlayer(resolution = {}) {
  const counts = new Map();
  for (const event of resolution.official_event_stream || []) {
    if (event.type !== 'goal' || event.own_goal !== true || !event.player_id) continue;
    const id = String(event.player_id);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function reconcileRows(rows = [], ownGoals) {
  return rows.map((row) => {
    const count = ownGoals.get(String(row.player_id)) || 0;
    if (!count || row.rating === null) return row;
    const eventImpact = number(row.components?.event_impact) - count * 1.15;
    const rating = Number(clamp(number(row.rating) - count * 1.15, 1, 10).toFixed(1));
    return {
      ...row,
      rating,
      components: row.components ? { ...row.components, event_impact: Number(eventImpact.toFixed(3)) } : row.components,
      highlights: [...(row.highlights || []).filter((label) => !/^\d+ goals?$/.test(label)), `${count} own goal${count === 1 ? '' : 's'}`]
    };
  }).sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || String(left.player_id).localeCompare(String(right.player_id)));
}

export function reconcileOwnGoalRatings(ratings, resolution) {
  if (!ratings?.deterministic) return ratings;
  const ownGoals = ownGoalsByPlayer(resolution);
  if (!ownGoals.size) return ratings;
  const home = reconcileRows(ratings.home, ownGoals);
  const away = reconcileRows(ratings.away, ownGoals);
  const rated = [...home, ...away].filter((row) => row.rating !== null)
    .sort((a, b) => b.rating - a.rating || b.minutes_played - a.minutes_played || String(a.player_id).localeCompare(String(b.player_id)));
  return {
    ...ratings,
    version: `${ratings.version}+own-goal-v0.1`,
    home,
    away,
    player_of_the_match: rated[0] || null
  };
}
