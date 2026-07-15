const WORLD_URL = process.env.TBG_WORLD_URL || "https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json";
const PINK_FINAL_PLAYER_URL = process.env.TBG_PLAYER_PROFILE_URL || "https://davidmarsden.github.io/beautiful-game-data/players/";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function specificPosition(player) {
  return text(
    player.position ||
    player.primary_position ||
    player.position_name ||
    player.position_detail ||
    player.transfermarkt_position ||
    player.canonical_position ||
    player.position_group
  ) || "Unknown";
}

function squadProjection(player, index, ownership) {
  const contract = ownership?.contract || player.contract || {};
  const condition = player.condition || {};
  const transfer = player.transfer || {};
  const id = player.tbg_player_id || player.transfermarkt_id;
  return {
    ...player,
    squad_number: number(player.squad_number, index + 1),
    specific_position: specificPosition(player),
    fitness: number(condition.fitness ?? player.fitness, 100),
    morale: text(condition.morale ?? player.morale) || "Good",
    injury_status: text(condition.injury_status ?? player.injury_status) || "Available",
    contract_expiry: text(contract.expires_on || contract.expiry_date || contract.expires_season_id) || "Open-ended",
    transfer_listed: Boolean(transfer.listed ?? player.transfer_listed),
    loan_listed: Boolean(transfer.loan_listed ?? player.loan_listed),
    profile_url: `${PINK_FINAL_PLAYER_URL}?id=${encodeURIComponent(id)}`
  };
}

export default async (request) => {
  try {
    const response = await fetch(WORLD_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`World source returned ${response.status}`);
    const world = await response.json();
    const url = new URL(request.url);
    const requestedClub = url.searchParams.get("club_id");
    const club = world.clubs.find((row) => row.tbg_club_id === requestedClub) || world.clubs[0];
    const playersById = new Map(world.players.map((player) => [player.tbg_player_id, player]));
    const ownershipById = new Map((world.player_ownership || []).map((row) => [row.tbg_player_id, row]));
    const rawSquad = (club.squad?.player_ids || []).map((id) => playersById.get(id)).filter(Boolean);
    const squad = rawSquad.map((player, index) => squadProjection(player, index, ownershipById.get(player.tbg_player_id)));
    const opponent = world.clubs.find((candidate) => candidate.division_id === club.division_id && candidate.tbg_club_id !== club.tbg_club_id) || world.clubs.find((candidate) => candidate.tbg_club_id !== club.tbg_club_id);
    return new Response(JSON.stringify({
      world: { world_id: world.world_id, season_id: world.active_season_id, status: world.status },
      manager: { manager_id: "manager-demo", manager_name: "Demo Manager", manager_type: "human" },
      club,
      squad,
      next_fixture: { fixture_id: `fixture-demo-${club.tbg_club_id}`, competition: club.division_id ? club.division_id.replace("division-", "Division ") : "Pre-season", opponent_name: opponent?.canonical_name || "Opponent TBC", venue: "home", status: "team_selection_open" },
      navigation: ["Dashboard","Squad","Tactics","Schedule","Finances","Facilities","History","Transfers","Competitions","World"]
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 503, headers: { "content-type": "application/json" } });
  }
};
