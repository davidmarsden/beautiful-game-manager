const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const SQUAD_INTELLIGENCE_VERSION = 'tbg-squad-intelligence-v1.0';
export const DEFAULT_HARD_MINIMUM_SQUAD = 18;
export const DEFAULT_PREFERRED_MINIMUM_SQUAD = 22;

const GROUP_REQUIREMENTS = Object.freeze({
  goalkeeper: 2,
  defender: 6,
  midfielder: 5,
  attacker: 3
});

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

function positionGroup(position) {
  const value = text(position).toLowerCase();
  if (value.includes('goalkeeper') || value === 'gk') return 'goalkeeper';
  if (value.includes('back') || value.includes('defender') || value.includes('defence')) return 'defender';
  if (value.includes('midfield') || value.includes('wing-back')) return 'midfielder';
  return 'attacker';
}

function availabilityFor(availability, id) {
  if (!availability) return { available: true, reason: null };
  const row = availability[id] || (Array.isArray(availability) ? availability.find((item) => text(item.player_id) === id) : null);
  if (!row) return { available: true, reason: null };
  return { available: row.available !== false, reason: row.reason || null };
}

function contractFor(state, player) {
  return state.contracts?.[player.contract_id] || null;
}

function yearsUntil(endAt, at) {
  if (!endAt) return null;
  return (new Date(endAt).getTime() - new Date(at).getTime()) / (365 * 86400000);
}

function roleFor({ rank, seniorCount, age, registered }) {
  if (!registered) return age <= 21 ? 'prospect' : 'surplus';
  if (age <= 21 && rank >= Math.max(11, Math.ceil(seniorCount * 0.6))) return 'prospect';
  if (rank < Math.min(4, seniorCount)) return 'key_player';
  if (rank < Math.min(11, seniorCount)) return 'starter';
  if (rank < Math.min(16, seniorCount)) return 'rotation';
  return 'depth';
}

function severityFor(gap) {
  if (gap >= 3) return 'critical';
  if (gap === 2) return 'high';
  if (gap === 1) return 'medium';
  return 'none';
}

export function analyseSquad(state, {
  clubId,
  at = state.calendar?.season_start || new Date().toISOString(),
  availability = null,
  hardMinimum = DEFAULT_HARD_MINIMUM_SQUAD,
  preferredMinimum = DEFAULT_PREFERRED_MINIMUM_SQUAD
} = {}) {
  const club = state.clubs?.[text(clubId)];
  if (!club) throw new Error(`Unknown club: ${clubId}`);

  const players = club.player_ids.map((id) => state.players[id]).filter(Boolean);
  const registeredIds = new Set(club.registered_player_ids || []);
  const seniorPlayers = players.filter((player) => number(player.age, 24) >= 19 || !player.youth_intake_season);
  const ranked = [...seniorPlayers].sort((a, b) => number(b.underlying_ability_rating ?? b.rating) - number(a.underlying_ability_rating ?? a.rating) || playerId(a).localeCompare(playerId(b)));
  const rankById = new Map(ranked.map((player, index) => [playerId(player), index]));

  const rows = players.map((player) => {
    const id = playerId(player);
    const registered = registeredIds.has(id);
    const availabilityRow = availabilityFor(availability, id);
    const contract = contractFor(state, player);
    const years = yearsUntil(contract?.end_at, at);
    return Object.freeze({
      player_id: id,
      display_name: text(player.display_name || player.name || id),
      age: number(player.age, 24),
      position: text(player.position),
      position_group: positionGroup(player.position),
      rating: number(player.underlying_ability_rating ?? player.rating),
      registered,
      available: registered && availabilityRow.available,
      unavailable_reason: registered && !availabilityRow.available ? availabilityRow.reason : null,
      contract_end_at: contract?.end_at || null,
      contract_horizon: years === null ? 'unknown' : years <= 0.5 ? 'expiring_this_season' : years <= 1.5 ? 'expiring_next_season' : 'secure',
      squad_role: roleFor({ rank: rankById.get(id) ?? ranked.length, seniorCount: ranked.length, age: number(player.age, 24), registered })
    });
  });

  const registeredSenior = rows.filter((row) => row.registered && row.age >= 19);
  const availableSenior = registeredSenior.filter((row) => row.available);
  const coverage = Object.entries(GROUP_REQUIREMENTS).map(([group, required]) => {
    const registered = registeredSenior.filter((row) => row.position_group === group).length;
    const available = availableSenior.filter((row) => row.position_group === group).length;
    const registeredGap = Math.max(0, required - registered);
    const availableGap = Math.max(0, required - available);
    return Object.freeze({ group, required, registered, available, registered_gap: registeredGap, available_gap: availableGap, severity: severityFor(Math.max(registeredGap, availableGap)) });
  });

  const hardGap = Math.max(0, hardMinimum - registeredSenior.length);
  const preferredGap = Math.max(0, preferredMinimum - registeredSenior.length);
  const expiringThisSeason = rows.filter((row) => row.contract_horizon === 'expiring_this_season');
  const expiringNextSeason = rows.filter((row) => row.contract_horizon === 'expiring_next_season');
  const needs = [];

  if (hardGap) needs.push(Object.freeze({ type: 'squad_size', severity: 'critical', gap: hardGap, message: `${hardGap} senior registrations below the hard minimum` }));
  else if (preferredGap) needs.push(Object.freeze({ type: 'squad_size', severity: preferredGap >= 3 ? 'high' : 'medium', gap: preferredGap, message: `${preferredGap} senior registrations below the preferred range` }));

  for (const row of coverage.filter((item) => item.registered_gap > 0)) {
    needs.push(Object.freeze({ type: 'position_group', group: row.group, severity: row.severity, gap: row.registered_gap, message: `${row.group} depth is ${row.registered_gap} below minimum coverage` }));
  }

  for (const row of coverage.filter((item) => item.registered_gap === 0 && item.available_gap > 0)) {
    needs.push(Object.freeze({ type: 'temporary_availability', group: row.group, severity: row.severity, gap: row.available_gap, message: `${row.group} availability is temporarily ${row.available_gap} below cover` }));
  }

  return Object.freeze({
    version: SQUAD_INTELLIGENCE_VERSION,
    club_id: club.club_id,
    at: new Date(at).toISOString(),
    summary: Object.freeze({
      owned_players: rows.length,
      senior_players: rows.filter((row) => row.age >= 19).length,
      registered_seniors: registeredSenior.length,
      available_seniors: availableSenior.length,
      hard_minimum: hardMinimum,
      preferred_minimum: preferredMinimum,
      hard_minimum_gap: hardGap,
      preferred_minimum_gap: preferredGap,
      expiring_this_season: expiringThisSeason.length,
      expiring_next_season: expiringNextSeason.length
    }),
    coverage: Object.freeze(coverage),
    players: Object.freeze(rows),
    contracts: Object.freeze({
      expiring_this_season: Object.freeze(expiringThisSeason.map((row) => row.player_id)),
      expiring_next_season: Object.freeze(expiringNextSeason.map((row) => row.player_id))
    }),
    needs: Object.freeze(needs),
    viable: hardGap === 0 && coverage.every((row) => row.registered_gap === 0)
  });
}

export function analyseWorldSquads(state, options = {}) {
  return Object.freeze(Object.keys(state.clubs || {}).sort().map((clubId) => analyseSquad(state, { ...options, clubId })));
}
