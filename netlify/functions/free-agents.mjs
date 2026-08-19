const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const DEFAULT_UNSIGNED_PLAYERS_URL = 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/tbg-player-pools/unsigned-players.json';
const UNSIGNED_PLAYERS_URL = process.env.TBG_UNSIGNED_PLAYERS_URL || DEFAULT_UNSIGNED_PLAYERS_URL;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function requireUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  return response.json();
}

const compact = (player) => ({
  tbg_player_id: player.tbg_player_id,
  transfermarkt_id: player.transfermarkt_id,
  display_name: player.display_name,
  age: player.age,
  position: player.position,
  position_group: player.position_group,
  nationality: player.nationality,
  current_club: player.current_club,
  market_value_eur: player.market_value_eur,
  tbg_rating: player.tbg_rating ?? player.underlying_ability_rating,
  rating_band: player.rating_band,
  status: player.status,
  profile_url: player.profile_url,
  last_seen_at: player.last_seen_at
});

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    await requireUser(token);

    const url = new URL(request.url);
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const tmId = String(url.searchParams.get('tm_id') || '').trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 30) || 30));

    const response = await fetch(UNSIGNED_PLAYERS_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) return json({ error: `Player universe unavailable (HTTP ${response.status})` }, 503);
    const rows = await response.json();
    const players = (Array.isArray(rows) ? rows : [])
      .filter((player) => player?.assignment_status === 'unsigned')
      .filter((player) => player?.status !== 'retired')
      .filter((player) => !tmId || String(player.transfermarkt_id || '') === tmId)
      .filter((player) => {
        if (!query) return true;
        const haystack = [player.display_name, player.full_name, player.position, player.current_club, ...(player.nationality || [])]
          .join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, limit)
      .map(compact);

    if (tmId && !players.length) return json({
      error: 'No unowned TBG/TPF player matches that Transfermarkt ID',
      transfermarkt_id: tmId,
      external_import_required: true
    }, 404);

    return json({
      source: 'beautiful-game-data/derived/tbg-player-pools/unsigned-players.json',
      query: query || null,
      transfermarkt_id: tmId || null,
      count: players.length,
      players
    });
  } catch (error) {
    return json({ error: error.message || 'Free-agent search failed' }, 500);
  }
};
