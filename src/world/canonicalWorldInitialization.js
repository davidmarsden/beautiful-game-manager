import { createPersistentLeagueWorld, validatePersistentLeagueWorld } from './persistentLeagueWorld.js';
import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';

export const CANONICAL_WORLD_INITIALIZATION_VERSION = 'tbg-canonical-world-initialization-v1.0';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function divisionLevel(value) {
  const source = text(value).toLowerCase();
  const match = source.match(/(?:division|div|d)[-_ ]?([1-5])\b/) || source.match(/^([1-5])$/);
  return match ? Number(match[1]) : null;
}

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.transfermarkt_id || player?.id);
}

function projectPlayer(player, index, registrationLimit) {
  const id = playerId(player);
  if (!id) throw new Error('Publication player is missing a stable ID');
  return {
    ...player,
    tbg_player_id: id,
    display_name: text(player.display_name || player.canonical_name || player.name || id),
    age: number(player.age ?? player.season_start_age, 24),
    underlying_ability_rating: number(player.underlying_ability_rating ?? player.rating ?? player.overall_rating, 75),
    registered: index < registrationLimit
  };
}

function projectClub(sourceClub, playersById, registrationLimit) {
  const clubId = text(sourceClub.tbg_club_id || sourceClub.club_id || sourceClub.id);
  if (!clubId) throw new Error('Publication club is missing a stable ID');
  const squadIds = sourceClub.squad?.player_ids || sourceClub.player_ids || [];
  const players = squadIds.map((id) => playersById.get(text(id))).filter(Boolean);
  if (players.length < 18) throw new Error(`${clubId} has only ${players.length} published squad players`);
  return {
    club_id: clubId,
    club_name: text(sourceClub.canonical_name || sourceClub.club_name || sourceClub.name || clubId),
    formation: text(sourceClub.formation) || '4-3-3-wide',
    tactics: { style: 'balanced', route_to_goal: 'balanced', pressing: 'mid', tempo: 'normal', mentality: 'balanced', ...(sourceClub.tactics || {}) },
    players: players.map((player, index) => projectPlayer(player, index, registrationLimit))
  };
}

export function buildCanonicalWorldFromPublication(publicationWorld, {
  worldId,
  humanClubId,
  seasonStart = '2026-08-01T00:00:00.000Z',
  seasonEnd = '2027-06-30T23:59:59.000Z',
  registrationLimit = 25,
  movementCount = 4
} = {}) {
  if (!publicationWorld || !Array.isArray(publicationWorld.clubs) || !Array.isArray(publicationWorld.players)) {
    throw new Error('Published world must contain clubs and players');
  }
  const resolvedWorldId = text(worldId || publicationWorld.world_id);
  if (!resolvedWorldId) throw new Error('Canonical world ID is required');
  const playersById = new Map(publicationWorld.players.map((player) => [playerId(player), player]).filter(([id]) => id));
  const divisions = [1, 2, 3, 4, 5].map((level) => {
    const clubs = publicationWorld.clubs
      .filter((club) => divisionLevel(club.division_id || club.division || club.level) === level)
      .map((club) => projectClub(club, playersById, registrationLimit));
    if (clubs.length < 4) throw new Error(`Division ${level} has only ${clubs.length} usable clubs`);
    return { division_id: `d${level}`, level, club_count: clubs.length, clubs };
  });
  const clubIds = divisions.flatMap((division) => division.clubs.map((club) => club.club_id));
  const resolvedHumanClubId = text(humanClubId);
  if (!clubIds.includes(resolvedHumanClubId)) throw new Error(`Administrator club ${resolvedHumanClubId} is not in the published world`);
  const world = createPersistentLeagueWorld({
    worldId: resolvedWorldId,
    divisions,
    humanClubId: resolvedHumanClubId,
    seasonStart,
    seasonEnd,
    movementCount
  });
  const validation = validatePersistentLeagueWorld(world);
  if (!validation.valid) throw new Error(`Initial canonical world is invalid: ${validation.errors.join('; ')}`);
  const serialized = savePersistentWorld(world);
  const envelope = JSON.parse(serialized);
  const restored = loadPersistentWorld(serialized);
  return Object.freeze({
    version: CANONICAL_WORLD_INITIALIZATION_VERSION,
    world: restored,
    envelope,
    summary: Object.freeze({
      world_id: restored.world_id,
      season_id: restored.squad_cycle.season_id,
      season_number: restored.season_number,
      phase: restored.phase,
      division_count: restored.competition.divisions.length,
      club_count: clubIds.length,
      player_count: Object.keys(restored.squad_cycle.players).length,
      registered_player_count: Object.values(restored.squad_cycle.clubs).reduce((sum, club) => sum + club.registered_player_ids.length, 0)
    })
  });
}
