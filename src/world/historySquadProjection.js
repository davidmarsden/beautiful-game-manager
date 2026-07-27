import { projectManagerPortal } from './managerPortalProjection.js';
import { projectPinkFinalPlayerIdentity } from './pinkFinalPlayerProfile.js';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const POSITION_GROUPS = Object.freeze({
  goalkeeper: new Set(['gk', 'goalkeeper']),
  defender: new Set(['cb', 'rb', 'lb', 'lwb', 'rwb', 'def', 'defender', 'centre-back', 'center-back', 'left-back', 'right-back', 'left wing-back', 'right wing-back']),
  midfielder: new Set(['dm', 'cm', 'am', 'mid', 'midfielder', 'defensive midfield', 'central midfield', 'attacking midfield']),
  attacker: new Set(['lw', 'rw', 'ss', 'cf', 'st', 'att', 'attacker', 'forward', 'left winger', 'right winger', 'second striker', 'centre-forward', 'center-forward', 'striker'])
});
const GROUP_REQUIREMENTS = Object.freeze({ goalkeeper: 2, defender: 6, midfielder: 5, attacker: 3 });

function positionOf(player) {
  return text(player?.specific_position || player?.position || player?.primary_position || player?.canonical_position || player?.position_group) || 'Unknown';
}

function positionGroup(value) {
  const raw = text(value).toLowerCase();
  for (const [group, aliases] of Object.entries(POSITION_GROUPS)) if (aliases.has(raw)) return group;
  if (raw.includes('goalkeeper')) return 'goalkeeper';
  if (raw.includes('back') || raw.includes('defender') || raw.includes('defence')) return 'defender';
  if (raw.includes('midfield')) return 'midfielder';
  return 'attacker';
}

function isYouth(player) {
  const registration = text(player?.squad_registration || player?.registration_group || player?.squad_status).toLowerCase();
  if (['youth', 'youth_only', 'academy'].includes(registration)) return true;
  if (player?.youth_eligible_at_season_start !== undefined) return Boolean(player.youth_eligible_at_season_start);
  return number(player?.season_start_age ?? player?.age, 99) <= 21;
}

function isLoanedOut(player) {
  return Boolean(player?.loaned_out || text(player?.loan_status).toLowerCase() === 'loaned_out');
}

function isAvailable(player) {
  const status = text(player?.injury_status || player?.availability || 'available').toLowerCase();
  return !['injured', 'suspended', 'unavailable'].some((word) => status.includes(word));
}

function contractDate(player) {
  const value = player?.contract_expiry || player?.contract_end_at || player?.contract?.end_at;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safePlayer(playerId, player) {
  return {
    player_id: playerId,
    tbg_player_id: player.tbg_player_id || playerId,
    display_name: text(player.display_name || player.name || player.player_name) || playerId,
    specific_position: positionOf(player),
    position: positionOf(player),
    age: number(player.age),
    season_start_age: number(player.season_start_age),
    youth_eligible_at_season_start: player.youth_eligible_at_season_start ?? isYouth(player),
    underlying_ability_rating: number(player.underlying_ability_rating ?? player.rating),
    rating: number(player.underlying_ability_rating ?? player.rating),
    squad_number: number(player.squad_number),
    fitness: number(player.fitness, 100),
    morale: text(player.morale) || 'Good',
    injury_status: text(player.injury_status || player.availability) || 'Available',
    availability: text(player.availability || player.injury_status) || 'Available',
    contract_expiry: player.contract_expiry || player.contract_end_at || player.contract?.end_at || null,
    registered: Boolean(player.registered),
    registration_status: player.registered ? 'registered' : 'unregistered',
    transfer_listed: Boolean(player.transfer_listed),
    loan_listed: Boolean(player.loan_listed),
    loaned_out: isLoanedOut(player),
    loan_status: player.loan_status || null,
    loan_club_name: text(player.loan_club_name) || null,
    profile_url: player.profile_url || null,
    pink_final_profile_url: player.pink_final_profile_url || null,
    public_profile_url: player.public_profile_url || null,
    pink_final_route_key: player.pink_final_route_key || null,
    profile_route_key: player.profile_route_key || null,
    canonical_profile_key: player.canonical_profile_key || null,
    profile_published: player.profile_published,
    pink_final_profile_published: player.pink_final_profile_published,
    public_profile_published: player.public_profile_published,
    publication_status: player.publication_status,
    profile_status: player.profile_status
  };
}

function squadCoverage(players) {
  const registered = players.filter((player) => player.registered && !isYouth(player) && !isLoanedOut(player));
  const available = registered.filter(isAvailable);
  return Object.entries(GROUP_REQUIREMENTS).map(([group, required]) => {
    const registeredCount = registered.filter((player) => positionGroup(positionOf(player)) === group).length;
    const availableCount = available.filter((player) => positionGroup(positionOf(player)) === group).length;
    return { group, required, registered: registeredCount, available: availableCount, gap: Math.max(0, required - registeredCount), temporary_gap: Math.max(0, required - availableCount) };
  });
}

function contractWatch(players, now = new Date()) {
  return players.map((player) => ({ player, end: contractDate(player) }))
    .filter((row) => row.end)
    .map((row) => ({ ...row, days: Math.ceil((row.end.getTime() - now.getTime()) / 86400000) }))
    .filter((row) => row.days <= 365)
    .sort((a, b) => a.end - b.end || a.player.display_name.localeCompare(b.player.display_name))
    .map((row) => ({ player_id: row.player.player_id, player_name: row.player.display_name, position: positionOf(row.player), end_at: row.end.toISOString(), days_remaining: row.days }));
}

export function enrichHistorySquads(projection, world, { now = new Date(), pinkFinalBaseUrl = projection?.pink_final_base_url } = {}) {
  const clubs = Object.fromEntries(Object.entries(projection.clubs || {}).map(([clubId, projected]) => {
    const portal = projectManagerPortal(world, clubId);
    const linkOptions = pinkFinalBaseUrl ? { baseUrl: pinkFinalBaseUrl } : {};
    const players = portal.squad.map((player) => projectPinkFinalPlayerIdentity(safePlayer(player.tbg_player_id || player.player_id, player), linkOptions));
    return [clubId, {
      ...projected,
      player_count: players.length,
      squad_rules: { first_team_capacity: portal.club.squad.first_team_capacity, youth_team_capacity: portal.club.squad.youth_team_capacity },
      coverage: squadCoverage(players),
      contracts: contractWatch(players, now),
      players
    }];
  }));
  return { ...projection, clubs };
}
