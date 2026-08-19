import { signFreeAgent } from './_lib/free-agent-settlement.mjs';

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

async function userSupabase(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  const user = await response.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await userSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

async function unsignedPlayerPool() {
  const response = await fetch(UNSIGNED_PLAYERS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Player universe unavailable (HTTP ${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
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

function isUnsignedActive(player) {
  const lifecycle = String(player?.lifecycle_status || player?.lifecycleStatus || '').toLowerCase();
  return player?.assignment_status === 'unsigned'
    && player?.status !== 'retired'
    && player?.active_circulation !== false
    && !['inactive', 'retired'].includes(lifecycle);
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const rows = await unsignedPlayerPool();

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const tmId = String(url.searchParams.get('tm_id') || '').trim();
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 30) || 30));
      const players = rows
        .filter(isUnsignedActive)
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
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    if (action !== 'sign') return json({ error: 'Unsupported free-agent action' }, 400);
    const playerId = String(body.player_id || body.playerId || '').trim();
    const tmId = String(body.transfermarkt_id || body.transfermarktId || '').trim();
    if (!playerId && !tmId) return json({ error: 'Player or Transfermarkt ID is required' }, 400);

    const player = rows.find((candidate) => isUnsignedActive(candidate)
      && (playerId ? String(candidate.tbg_player_id || '') === playerId : String(candidate.transfermarkt_id || '') === tmId));
    if (!player) return json({
      error: 'Player is no longer available in the governed free-agent pool',
      player_id: playerId || null,
      transfermarkt_id: tmId || null,
      external_import_required: Boolean(tmId)
    }, 404);

    const result = await signFreeAgent({
      userId: current.user.id,
      worldId: current.appointment.world_id,
      player,
      contractYears: Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3)),
      wage: Math.max(0, Math.round(Number(body.wage ?? 1000) || 1000)),
      clientRequestId: String(body.client_request_id || body.clientRequestId || '').trim() || `${Date.now()}-${player.tbg_player_id}`
    });

    if (!result?.accepted) {
      const status = result?.reason === 'player_already_acquired' ? 409
        : result?.status === 'application_failed' ? 409
          : /checkpoint_changed|world_/.test(String(result?.reason || '')) ? 409 : 400;
      return json({ ...result, error: result?.reason || 'Free-agent signing was not completed' }, status);
    }

    return json({
      ...result,
      message: result.idempotent || result.reconciled
        ? `${player.display_name || player.tbg_player_id} was already signed successfully.`
        : `${player.display_name || player.tbg_player_id} signed as a free agent.`,
      source: 'beautiful-game-data/derived/tbg-player-pools/unsigned-players.json'
    });
  } catch (error) {
    const message = String(error?.message || 'Free-agent request failed');
    const status = /Session|Authentication/.test(message) ? 401 : /appointment|profile/.test(message) ? 409 : /Player universe unavailable/.test(message) ? 503 : 500;
    return json({ error: message }, status);
  }
};
