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

function loanStatus(player, ownership) {
  const loan = ownership?.loan || player.loan || {};
  const status = text(loan.status || player.loan_status).toLowerCase();
  const loanClubId = text(loan.club_id || player.loan_club_id);
  const loanClubName = text(loan.club_name || player.loan_club_name);
  const loanedOut = Boolean(
    loanedOutValue(player.loaned_out) ||
    loanedOutValue(ownership?.loaned_out) ||
    status === "loaned_out" ||
    status === "out" ||
    loanClubId ||
    loanClubName
  );
  return { loaned_out: loanedOut, loan_club_id: loanClubId || null, loan_club_name: loanClubName || null };
}

function loanedOutValue(value) {
  return value === true || text(value).toLowerCase() === "true";
}

function squadProjection(player, index, ownership) {
  const contract = ownership?.contract || player.contract || {};
  const condition = player.condition || {};
  const transfer = player.transfer || {};
  const id = player.tbg_player_id || player.transfermarkt_id;
  const currentAge = number(player.age, null);
  const seasonStartAge = number(
    player.season_start_age ?? ownership?.season_start_age ?? contract.season_start_age,
    currentAge
  );
  const youthEligible = Boolean(
    player.youth_eligible_at_season_start ??
    ownership?.youth_eligible_at_season_start ??
    contract.squad_registration === "youth_eligible" ??
    (seasonStartAge !== null && seasonStartAge <= 21)
  );
  const loan = loanStatus(player, ownership);
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
    season_start_age: seasonStartAge,
    youth_eligible_at_season_start: youthEligible,
    squad_registration: youthEligible ? "youth" : "first_team",
    ...loan,
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
      squad_rules: {
        first_team_capacity: club.squad?.first_team_capacity ?? 25,
        youth_team_capacity: club.squad?.youth_team_capacity ?? 20,
        launch_first_team_cap: club.squad?.launch_first_team_cap ?? 20,
        launch_youth_team_cap: club.squad?.launch_youth_team_cap ?? 10,
        youth_age_rule: "Aged 21 or younger on the first day of the season"
      },
      next_fixture: { fixture_id: `fixture-demo-${club.tbg_club_id}`, competition: club.division_id ? club.division_id.replace("division-", "Division ") : "Pre-season", opponent_name: opponent?.canonical_name || "Opponent TBC", venue: "home", status: "team_selection_open" },
      navigation: ["Dashboard","Squad","Tactics","Schedule","Finances","Facilities","History","Transfers","Competitions","World"]
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 503, headers: { "content-type": "application/json" } });
  }
};
