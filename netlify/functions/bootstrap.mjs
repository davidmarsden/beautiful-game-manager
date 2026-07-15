const WORLD_URL = process.env.TBG_WORLD_URL || "https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json";

export default async (request) => {
  try {
    const response = await fetch(WORLD_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`World source returned ${response.status}`);
    const world = await response.json();
    const url = new URL(request.url);
    const requestedClub = url.searchParams.get("club_id");
    const club = world.clubs.find((row) => row.tbg_club_id === requestedClub) || world.clubs[0];
    const playersById = new Map(world.players.map((player) => [player.tbg_player_id, player]));
    const squad = (club.squad?.player_ids || []).map((id) => playersById.get(id)).filter(Boolean);
    const opponent = world.clubs.find((candidate) => candidate.division_id === club.division_id && candidate.tbg_club_id !== club.tbg_club_id) || world.clubs.find((candidate) => candidate.tbg_club_id !== club.tbg_club_id);
    return new Response(JSON.stringify({
      world: { world_id: world.world_id, season_id: world.active_season_id, status: world.status },
      manager: { manager_id: "manager-demo", manager_name: "Demo Manager", manager_type: "human" },
      club,
      squad,
      next_fixture: { fixture_id: `fixture-demo-${club.tbg_club_id}`, competition: club.division_id ? club.division_id.replace("division-", "Division ") : "Pre-season", opponent_name: opponent?.canonical_name || "Opponent TBC", venue: "home", status: "team_selection_open" },
      navigation: ["Dashboard","Squad","Tactics","Schedule","Finances","Facilities","History","Transfers","Competitions","Game World"]
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 503, headers: { "content-type": "application/json" } });
  }
};
