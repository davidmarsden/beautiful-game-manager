const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function clubPlayerIds(world, clubId) {
  const club = world.squad_cycle?.clubs?.[clubId] || {};
  return [...new Set([...(club.player_ids || []), ...(club.registered_player_ids || [])])];
}

function playerPayload(world, homeClubId, awayClubId) {
  const ids = [...new Set([...clubPlayerIds(world, homeClubId), ...clubPlayerIds(world, awayClubId)])];
  return Object.fromEntries(ids
    .filter((id) => world.squad_cycle?.players?.[id])
    .map((id) => [id, world.squad_cycle.players[id]]));
}

export function archiveRowsForCanonicalWorld(row) {
  const envelope = row?.save_envelope || {};
  const world = envelope.world || {};
  const seasonId = world.matchday_cycle?.season_id || row.season_id;
  const rows = [];

  for (const [competitionId, runtime] of Object.entries(world.matchday_cycle?.runtimes || {})) {
    for (const result of runtime.results || []) {
      const fixture = result.fixture || {};
      const fixtureId = String(fixture.fixture_id || result.fixture_id || '').trim();
      const homeClubId = String(fixture.home_club_id || result.home_club_id || '').trim();
      const awayClubId = String(fixture.away_club_id || result.away_club_id || '').trim();
      if (!fixtureId || !homeClubId || !awayClubId) continue;
      rows.push({
        fixture_id: fixtureId,
        world_id: row.world_id,
        season_id: seasonId,
        competition_id: competitionId,
        matchday: Number(fixture.matchday || result.matchday || Math.max(1, Number(row.matchday || 1) - 1)),
        home_club_id: homeClubId,
        away_club_id: awayClubId,
        played_at: fixture.kickoff_at || result.played_at || null,
        archive_payload: {
          fixture,
          result,
          club_profiles: {
            [homeClubId]: world.club_profiles?.[homeClubId] || null,
            [awayClubId]: world.club_profiles?.[awayClubId] || null
          },
          players: playerPayload(world, homeClubId, awayClubId)
        },
        source_checksum: row.save_checksum,
        updated_at: new Date().toISOString()
      });
    }
  }
  return rows;
}

export default async () => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Match archive projection is not configured' }, 503);
    const worlds = await service('/rest/v1/canonical_world_saves?turn_status=eq.open&select=world_id,save_checksum,save_envelope,season_id,matchday');
    let projected = 0;
    const worldResults = [];

    for (const worldRow of worlds) {
      const rows = archiveRowsForCanonicalWorld(worldRow);
      if (rows.length) {
        await service('/rest/v1/canonical_match_archives?on_conflict=fixture_id', {
          method: 'POST',
          body: JSON.stringify(rows),
          headers: { prefer: 'resolution=merge-duplicates,return=minimal' }
        });
      }
      projected += rows.length;
      worldResults.push({ world_id: worldRow.world_id, checksum: worldRow.save_checksum, projected: rows.length });
    }

    return json({ projected, worlds: worldResults });
  } catch (error) {
    return json({ error: error.message }, 503);
  }
};

export const config = { schedule: '*/5 * * * *' };