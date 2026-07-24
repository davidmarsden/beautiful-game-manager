import { createPersistentLeagueWorld, validatePersistentLeagueWorld } from './persistentLeagueWorld.js';
import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';
import { planCanonicalRegistrationRepair, selectViableRegistrationIds } from './viableCanonicalRegistration.js';
import { canonicalFreeAgentCandidates } from './canonicalFreeAgentReservoir.js';

export const CANONICAL_WORLD_INITIALIZATION_VERSION = 'tbg-canonical-world-initialization-v1.4';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function divisionLevel(value) {
  if (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20) return Number(value);
  const source = text(value).toLowerCase();
  if (!source) return null;
  const words = { one: 1, first: 1, i: 1, two: 2, second: 2, ii: 2, three: 3, third: 3, iii: 3, four: 4, fourth: 4, iv: 4, five: 5, fifth: 5, v: 5 };
  const numeric = source.match(/(?:division|div|tier|level|d)[-_ ]*0?([1-9]|1\d|20)(?:\b|[-_ ])/i)
    || source.match(/(?:^|[-_ ])0?([1-9]|1\d|20)(?:st|nd|rd|th)?(?:\b|[-_ ])/i);
  if (numeric) return Number(numeric[1]);
  for (const [label, level] of Object.entries(words)) {
    if (new RegExp(`(?:division|div|tier|level|d)[-_ ]*${label}(?:\\b|[-_ ])`, 'i').test(source)
      || new RegExp(`(?:^|[-_ ])${label}(?:\\b|[-_ ])`, 'i').test(source)) return level;
  }
  return null;
}

function playerId(player) { return text(player?.tbg_player_id || player?.player_id || player?.transfermarkt_id || player?.id); }
function playerReferenceId(reference) { return reference === null || reference === undefined ? '' : typeof reference === 'object' ? playerId(reference) : text(reference); }
function clubId(club) { return text(club?.tbg_club_id || club?.club_id || club?.id); }
function ownershipClubId(ownership) { return text(ownership?.club_id || ownership?.owner_club_id || ownership?.tbg_club_id || ownership?.owned_by_club_id); }

function explicitClubDivisionLevel(club) {
  const candidates = [club?.division_id, club?.division, club?.division_name, club?.division_number, club?.division_level, club?.league_division, club?.tier, club?.level, club?.competition?.division_id, club?.competition?.division, club?.competition?.level];
  for (const candidate of candidates) { const level = divisionLevel(candidate); if (level) return level; }
  return null;
}

function divisionRows(publicationWorld) {
  return [publicationWorld?.divisions, publicationWorld?.league_structure?.divisions, publicationWorld?.competition?.divisions, publicationWorld?.competitions?.league?.divisions]
    .flatMap((rows) => Array.isArray(rows) ? rows : []);
}

function membershipDivisionLevel(club, publicationWorld) {
  const id = clubId(club);
  if (!id) return null;
  for (const row of divisionRows(publicationWorld)) {
    const level = divisionLevel(row?.level ?? row?.division_level ?? row?.division_number ?? row?.division_id ?? row?.id ?? row?.name);
    if (!level) continue;
    const members = [
      ...(Array.isArray(row?.club_ids) ? row.club_ids : []),
      ...(Array.isArray(row?.clubs) ? row.clubs.map((entry) => typeof entry === 'object' ? clubId(entry) : text(entry)) : []),
      ...(Array.isArray(row?.members) ? row.members.map((entry) => typeof entry === 'object' ? clubId(entry) : text(entry)) : [])
    ].map(text);
    if (members.includes(id)) return level;
  }
  return null;
}

function clubDivisionLevel(club, publicationWorld) { return explicitClubDivisionLevel(club) || membershipDivisionLevel(club, publicationWorld); }

function publishedDivisionLevels(publicationWorld, resolvedLevels) {
  const rowLevels = divisionRows(publicationWorld).map((row) => divisionLevel(row?.level ?? row?.division_level ?? row?.division_number ?? row?.division_id ?? row?.id ?? row?.name)).filter(Boolean);
  const clubLevels = [...resolvedLevels.values()].filter(Boolean);
  const levels = [...new Set([...rowLevels, ...clubLevels])].sort((a, b) => a - b);
  if (levels.length < 2) throw new Error(`Published world must contain at least two divisions; found ${levels.length}`);
  levels.forEach((level, index) => { if (level !== index + 1) throw new Error(`Published divisions must be contiguous from Division 1; found ${levels.join(', ')}`); });
  return levels;
}

function projectPlayer(player, ownership, registered) {
  const id = playerId(player);
  if (!id) throw new Error('Publication player is missing a stable ID');
  return {
    ...player,
    ...(ownership?.contract ? { contract: ownership.contract } : {}),
    tbg_player_id: id,
    display_name: text(player.display_name || player.canonical_name || player.name || id),
    age: number(player.age ?? ownership?.season_start_age ?? player.season_start_age, 24),
    underlying_ability_rating: number(player.underlying_ability_rating ?? player.rating ?? player.overall_rating, 75),
    registered
  };
}

function projectClub(sourceClub, playersById, ownershipById, registrationLimit) {
  const id = clubId(sourceClub);
  if (!id) throw new Error('Publication club is missing a stable ID');
  const squadIds = sourceClub.squad?.player_ids || sourceClub.player_ids || [];
  const players = squadIds.map((playerReference) => {
    const stableId = playerReferenceId(playerReference);
    const player = playersById.get(stableId);
    const ownership = ownershipById.get(stableId);
    const ownerClubId = ownershipClubId(ownership);
    if (!player || (ownerClubId && ownerClubId !== id)) return null;
    return { player, ownership };
  }).filter(Boolean);
  if (players.length < 18) throw new Error(`${id} has only ${players.length} authoritatively owned published squad players`);
  const selection = selectViableRegistrationIds(players.map(({ player, ownership }) => ({ ...player, age: number(player.age ?? ownership?.season_start_age ?? player.season_start_age, 24) })), registrationLimit);
  const registeredIds = new Set(selection.selected_ids);
  return {
    club_id: id,
    club_name: text(sourceClub.canonical_name || sourceClub.club_name || sourceClub.name || id),
    formation: text(sourceClub.formation) || '4-3-3-wide',
    tactics: { style: 'balanced', route_to_goal: 'balanced', pressing: 'mid', tempo: 'normal', mentality: 'balanced', ...(sourceClub.tactics || {}) },
    players: players.map(({ player, ownership }) => projectPlayer(player, ownership, registeredIds.has(playerId(player))))
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
  if (!publicationWorld || !Array.isArray(publicationWorld.clubs) || !Array.isArray(publicationWorld.players)) throw new Error('Published world must contain clubs and players');
  if (!Number.isInteger(registrationLimit) || registrationLimit < 18) throw new Error('Registration limit must be an integer of at least 18');
  if (!Number.isInteger(movementCount) || movementCount < 1) throw new Error('Promotion and relegation places must be a positive integer');
  const resolvedWorldId = text(worldId || publicationWorld.world_id);
  if (!resolvedWorldId) throw new Error('Canonical world ID is required');
  const playersById = new Map(publicationWorld.players.map((player) => [playerId(player), player]).filter(([id]) => id));
  const ownershipById = new Map((publicationWorld.player_ownership || []).map((row) => [playerId(row), row]).filter(([id]) => id));
  const resolvedLevels = new Map(publicationWorld.clubs.map((club) => [clubId(club), clubDivisionLevel(club, publicationWorld)]));
  const levels = publishedDivisionLevels(publicationWorld, resolvedLevels);
  const divisions = levels.map((level) => {
    const matchingClubs = publicationWorld.clubs.filter((club) => resolvedLevels.get(clubId(club)) === level);
    const clubs = matchingClubs.map((club) => projectClub(club, playersById, ownershipById, registrationLimit));
    if (clubs.length < 4) {
      const unresolved = [...resolvedLevels.entries()].filter(([, resolved]) => !resolved).slice(0, 12).map(([id]) => id);
      throw new Error(`Division ${level} has only ${clubs.length} usable clubs${unresolved.length ? `; unresolved published clubs include ${unresolved.join(', ')}` : ''}`);
    }
    if (movementCount * 2 >= clubs.length) throw new Error(`Division ${level} needs more than ${movementCount * 2} clubs for ${movementCount}-up/${movementCount}-down`);
    return { division_id: `d${level}`, level, club_count: clubs.length, clubs };
  });
  const clubIds = divisions.flatMap((division) => division.clubs.map((club) => club.club_id));
  const resolvedHumanClubId = text(humanClubId);
  if (!clubIds.includes(resolvedHumanClubId)) throw new Error(`Administrator club ${resolvedHumanClubId} is not in the published world`);

  const projectedWorld = createPersistentLeagueWorld({ worldId: resolvedWorldId, divisions, humanClubId: resolvedHumanClubId, seasonStart, seasonEnd, movementCount });
  projectedWorld.squad_cycle.registration_limit = registrationLimit;
  const candidates = canonicalFreeAgentCandidates(publicationWorld, { existingPlayerIds: Object.keys(projectedWorld.squad_cycle.players) });
  const planned = planCanonicalRegistrationRepair(projectedWorld, {
    at: projectedWorld.squad_cycle.calendar?.transfer_windows?.[0]?.opens_at || projectedWorld.clock,
    freeAgentCandidates: candidates
  });
  if (!planned.preview.accepted) throw new Error(`Initial canonical world cannot be made viable: ${planned.preview.blocked.map((row) => row.club_name).join(', ')}`);
  const world = planned.world;
  world.canonical_free_agent_reservoir = {
    version: 'tbg-canonical-free-agent-reservoir-v1.2',
    candidate_count: candidates.length,
    materialised_player_ids: planned.preview.clubs.flatMap((club) => club.free_agents_signed.map((player) => player.player_id)),
    materialised_count: planned.preview.external_free_agents_materialised,
    publication_world_id: text(publicationWorld?.world_id) || null
  };

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
      registered_player_count: Object.values(restored.squad_cycle.clubs).reduce((sum, club) => sum + club.registered_player_ids.length, 0),
      free_agent_candidate_count: candidates.length,
      free_agent_signing_count: planned.preview.external_free_agents_materialised
    })
  });
}
