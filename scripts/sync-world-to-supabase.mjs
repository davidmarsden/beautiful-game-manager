const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORLD_URL = process.env.TBG_WORLD_URL || "https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const worldResponse = await fetch(WORLD_URL, { headers: { accept: "application/json" } });
if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
const world = await worldResponse.json();

const headers = {
  apikey: SERVICE_ROLE_KEY,
  authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
  prefer: "resolution=merge-duplicates,return=minimal"
};

const worldRow = {
  id: world.world_id || "tbg-world-1",
  name: world.name || "TBG World 1",
  active_season_id: world.active_season_id || "season-1",
  status: world.status || "setup",
  updated_at: new Date().toISOString()
};
const worldUpsert = await fetch(`${SUPABASE_URL}/rest/v1/worlds?on_conflict=id`, { method: "POST", headers, body: JSON.stringify([worldRow]) });
if (!worldUpsert.ok) throw new Error(`World upsert failed: ${worldUpsert.status} ${await worldUpsert.text()}`);

const clubs = (world.clubs || []).map((club) => ({
  id: club.tbg_club_id,
  world_id: worldRow.id,
  name: club.canonical_name,
  short_name: club.short_name || null,
  division_id: club.division_id || null,
  world_rank: club.strength?.world_rank || null,
  metadata: {
    transfermarkt_club_id: club.transfermarkt_club_id || null,
    country: club.country || null,
    league: club.league || null
  },
  updated_at: new Date().toISOString()
}));

for (let index = 0; index < clubs.length; index += 100) {
  const batch = clubs.slice(index, index + 100);
  const result = await fetch(`${SUPABASE_URL}/rest/v1/clubs?on_conflict=id`, { method: "POST", headers, body: JSON.stringify(batch) });
  if (!result.ok) throw new Error(`Club upsert failed: ${result.status} ${await result.text()}`);
}

console.log(`Synced ${clubs.length} clubs into ${worldRow.name}.`);
