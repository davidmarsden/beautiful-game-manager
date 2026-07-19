const integer = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const text = (value) => String(value ?? '').trim();

export const SQUAD_AVAILABILITY_VERSION = 'tbg-squad-availability-v1.0';

export function createSquadAvailability(playerIds = []) {
  if (!Array.isArray(playerIds)) throw new Error('playerIds must be an array');
  const ids = playerIds.map(text).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('playerIds must be unique');
  return {
    version: SQUAD_AVAILABILITY_VERSION,
    players: Object.fromEntries(ids.map((playerId) => [playerId, {
      injury_until_matchday: 0,
      suspension_until_matchday: 0,
      injury_reason: null,
      suspension_reason: null
    }]))
  };
}

export function availabilityForPlayer(calendar, playerId, matchday) {
  const row = calendar?.players?.[text(playerId)];
  if (!row) return Object.freeze({ available: false, reason: 'unknown_player' });
  const day = integer(matchday);
  if (row.injury_until_matchday >= day) return Object.freeze({ available: false, reason: 'injured', until_matchday: row.injury_until_matchday });
  if (row.suspension_until_matchday >= day) return Object.freeze({ available: false, reason: 'suspended', until_matchday: row.suspension_until_matchday });
  return Object.freeze({ available: true, reason: null, until_matchday: null });
}

function absenceLength(row, fields, fallback) {
  for (const field of fields) {
    const value = integer(row?.[field], 0);
    if (value > 0) return value;
  }
  return fallback;
}

export function applyAvailabilityChanges(calendar, result, fixture) {
  const matchday = integer(fixture?.matchday);
  if (matchday < 1) throw new Error('fixture.matchday must be a positive integer');
  const changes = [];

  for (const injury of result?.state_changes?.injuries || []) {
    const playerId = text(injury.player_id);
    const row = calendar.players[playerId];
    if (!row) continue;
    const matchesOut = absenceLength(injury, ['matches_out', 'absence_matchdays', 'recovery_matchdays'], 1);
    row.injury_until_matchday = Math.max(row.injury_until_matchday, matchday + matchesOut);
    row.injury_reason = text(injury.injury_type || injury.type || injury.severity) || 'match_injury';
    changes.push(Object.freeze({ player_id: playerId, kind: 'injury', matches_out: matchesOut, until_matchday: row.injury_until_matchday }));
  }

  for (const discipline of result?.state_changes?.discipline || []) {
    const playerId = text(discipline.player_id);
    const row = calendar.players[playerId];
    if (!row) continue;
    const explicit = absenceLength(discipline, ['suspension_matches', 'matches_suspended'], 0);
    const matchesOut = explicit || (discipline.sent_off ? 1 : 0);
    if (!matchesOut) continue;
    row.suspension_until_matchday = Math.max(row.suspension_until_matchday, matchday + matchesOut);
    row.suspension_reason = discipline.sent_off ? 'red_card' : 'disciplinary_suspension';
    changes.push(Object.freeze({ player_id: playerId, kind: 'suspension', matches_out: matchesOut, until_matchday: row.suspension_until_matchday }));
  }

  return Object.freeze(changes);
}

export function eligiblePlayerIds(calendar, playerIds, matchday) {
  return Object.freeze(playerIds.filter((playerId) => availabilityForPlayer(calendar, playerId, matchday).available));
}

export function availabilitySnapshot(calendar, matchday) {
  const rows = Object.entries(calendar.players).map(([playerId]) => ({ player_id: playerId, ...availabilityForPlayer(calendar, playerId, matchday) }));
  return Object.freeze({
    matchday,
    available: Object.freeze(rows.filter((row) => row.available)),
    unavailable: Object.freeze(rows.filter((row) => !row.available))
  });
}
