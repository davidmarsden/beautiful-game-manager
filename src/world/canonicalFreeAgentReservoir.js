const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const CANONICAL_FREE_AGENT_RESERVOIR_VERSION = 'tbg-canonical-free-agent-reservoir-v1.0';

const playerId = (player) => text(player?.tbg_player_id || player?.player_id || player?.transfermarkt_id || player?.id);
const clubId = (club) => text(club?.tbg_club_id || club?.club_id || club?.id);
const ownershipClubId = (ownership) => text(ownership?.club_id || ownership?.owner_club_id || ownership?.tbg_club_id || ownership?.owned_by_club_id);
const ownershipPlayerId = (ownership) => playerId(ownership);
const playerReferenceId = (reference) => typeof reference === 'object' ? playerId(reference) : text(reference);

function publishedSquadPlayerIds(publicationWorld) {
  const ids = new Set();
  for (const club of publicationWorld?.clubs || []) {
    const references = club?.squad?.player_ids || club?.player_ids || [];
    for (const reference of references) {
      const id = playerReferenceId(reference);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function projectFreeAgent(player, ownership) {
  const id = playerId(player);
  return {
    ...player,
    tbg_player_id: id,
    display_name: text(player?.display_name || player?.canonical_name || player?.name || id),
    age: number(player?.age ?? ownership?.season_start_age ?? player?.season_start_age, 24),
    underlying_ability_rating: number(player?.underlying_ability_rating ?? player?.rating ?? player?.overall_rating, 75),
    club_id: null,
    contract_id: null,
    canonical_status: 'free_agent'
  };
}

export function canonicalFreeAgentCandidates(publicationWorld, { existingPlayerIds = [] } = {}) {
  if (!publicationWorld || !Array.isArray(publicationWorld.players)) throw new Error('Published world must contain players');
  const existing = new Set(existingPlayerIds.map(text).filter(Boolean));
  const squadPlayers = publishedSquadPlayerIds(publicationWorld);
  const ownershipById = new Map((publicationWorld.player_ownership || []).map((row) => [ownershipPlayerId(row), row]).filter(([id]) => id));

  return Object.freeze(publicationWorld.players
    .map((player, sourceIndex) => ({ player, sourceIndex, id: playerId(player), ownership: ownershipById.get(playerId(player)) || null }))
    .filter(({ id, ownership }) => id && !existing.has(id) && !squadPlayers.has(id) && !ownershipClubId(ownership))
    .map(({ player, ownership, sourceIndex }) => Object.freeze({ source_index: sourceIndex, player: Object.freeze(projectFreeAgent(player, ownership)) })));
}

export function importCanonicalFreeAgentReservoir(world, publicationWorld) {
  const state = world?.squad_cycle;
  if (!state?.players || !state?.registrations) throw new Error('Canonical world is missing squad-cycle state');
  const candidates = canonicalFreeAgentCandidates(publicationWorld, { existingPlayerIds: Object.keys(state.players) });
  const imported = [];

  for (const row of candidates) {
    const player = { ...row.player };
    state.players[player.tbg_player_id] = player;
    state.registrations[player.tbg_player_id] = {
      player_id: player.tbg_player_id,
      club_id: null,
      registered: false,
      registered_at: null
    };
    imported.push(player.tbg_player_id);
  }

  world.canonical_free_agent_reservoir = {
    version: CANONICAL_FREE_AGENT_RESERVOIR_VERSION,
    imported_player_ids: imported,
    imported_count: imported.length,
    publication_world_id: text(publicationWorld?.world_id) || null
  };

  return Object.freeze({
    version: CANONICAL_FREE_AGENT_RESERVOIR_VERSION,
    imported_count: imported.length,
    imported_player_ids: Object.freeze(imported)
  });
}
