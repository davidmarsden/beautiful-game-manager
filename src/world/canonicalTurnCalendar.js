export const CANONICAL_TURN_CALENDAR_VERSION = 'tbg-canonical-turn-calendar-v1.0';
export const DEFAULT_TURN_WEEKDAYS_UTC = Object.freeze([2, 5]);
export const DEFAULT_TURN_HOUR_UTC = 20;

function validDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function normalizedWeekdays(values = DEFAULT_TURN_WEEKDAYS_UTC) {
  const days = [...new Set((values || []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (!days.length) throw new Error('Canonical turn calendar requires at least one weekday');
  return days;
}

export function nextCanonicalTurn(after, {
  weekdaysUtc = DEFAULT_TURN_WEEKDAYS_UTC,
  hourUtc = DEFAULT_TURN_HOUR_UTC
} = {}) {
  const start = validDate(after, 'turn calendar date');
  const weekdays = normalizedWeekdays(weekdaysUtc);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + offset,
      Number(hourUtc),
      0,
      0,
      0
    ));
    if (weekdays.includes(candidate.getUTCDay()) && candidate > start) return candidate.toISOString();
  }
  throw new Error('Could not resolve the next canonical turn');
}

export function canonicalMatchdayKickoffs({
  firstMatchday,
  firstKickoffAt,
  lastMatchday,
  secondKickoffAt = null,
  weekdaysUtc = DEFAULT_TURN_WEEKDAYS_UTC,
  hourUtc = DEFAULT_TURN_HOUR_UTC
} = {}) {
  const first = Number(firstMatchday);
  const last = Number(lastMatchday);
  if (!Number.isInteger(first) || first < 1) throw new Error(`Invalid first matchday: ${firstMatchday}`);
  if (!Number.isInteger(last) || last < first) throw new Error(`Invalid last matchday: ${lastMatchday}`);
  const schedule = new Map([[first, validDate(firstKickoffAt, 'first kickoff').toISOString()]]);
  if (last === first) return schedule;

  let current = secondKickoffAt
    ? validDate(secondKickoffAt, 'second kickoff').toISOString()
    : nextCanonicalTurn(schedule.get(first), { weekdaysUtc, hourUtc });
  schedule.set(first + 1, current);
  for (let matchday = first + 2; matchday <= last; matchday += 1) {
    current = nextCanonicalTurn(current, { weekdaysUtc, hourUtc });
    schedule.set(matchday, current);
  }
  return schedule;
}

export function alignCanonicalFixtureKickoffs(world, {
  currentMatchday = world?.matchday_cycle?.current_matchday || 1,
  currentTurnAt,
  nextTurnAt = null,
  weekdaysUtc = DEFAULT_TURN_WEEKDAYS_UTC,
  hourUtc = DEFAULT_TURN_HOUR_UTC
} = {}) {
  if (!world?.matchday_cycle?.runtimes) return world;
  const maximumMatchday = Number(world.matchday_cycle.maximum_matchday || 0);
  if (!maximumMatchday || !currentTurnAt) return world;
  const schedule = canonicalMatchdayKickoffs({
    firstMatchday: currentMatchday,
    firstKickoffAt: currentTurnAt,
    lastMatchday: maximumMatchday,
    secondKickoffAt: nextTurnAt,
    weekdaysUtc,
    hourUtc
  });
  for (const runtime of Object.values(world.matchday_cycle.runtimes)) {
    for (const fixture of runtime.fixtures || []) {
      const kickoffAt = schedule.get(Number(fixture.matchday));
      if (kickoffAt) fixture.kickoff_at = kickoffAt;
    }
  }
  world.matchday_cycle.turn_calendar = {
    version: CANONICAL_TURN_CALENDAR_VERSION,
    weekdays_utc: [...normalizedWeekdays(weekdaysUtc)],
    hour_utc: Number(hourUtc),
    aligned_from_matchday: Number(currentMatchday),
    aligned_at: validDate(currentTurnAt, 'alignment date').toISOString()
  };
  return world;
}
