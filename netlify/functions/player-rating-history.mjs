const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PLAYER_RATING_HISTORY_URL = process.env.TBG_PLAYER_RATING_HISTORY_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-changes/player-rating-history.json';
const CACHE_MS = Math.max(5000, Number(process.env.TBG_PLAYER_RATING_HISTORY_CACHE_MS) || 30000);

let historyPromise = null;
let historyLoadedAt = 0;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function requireManager(token) {
  if (!token) throw new Error('Sign in to view player rating history.');
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (!response.ok) throw new Error('Unable to verify manager profile');
  const profiles = await response.json();
  if (!profiles[0]) throw new Error('Manager profile has not been created yet');
}

async function ratingHistory() {
  if (!historyPromise || Date.now() - historyLoadedAt >= CACHE_MS) {
    historyLoadedAt = Date.now();
    historyPromise = fetch(PLAYER_RATING_HISTORY_URL, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404) return { version: 'tbg-player-rating-history-v1', player_count: 0, players: {} };
        if (!response.ok) throw new Error(`Player rating history unavailable (HTTP ${response.status})`);
        return response.json();
      })
      .catch((error) => { historyPromise = null; historyLoadedAt = 0; throw error; });
  }
  return historyPromise;
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    await requireManager(bearerToken(request));
    const history = await ratingHistory();
    const playerId = new URL(request.url).searchParams.get('player_id')?.trim();
    if (!playerId) return json(history);
    return json({ version: history.version, generated_at: history.generated_at || null, player: history.players?.[playerId] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load player rating history';
    const status = /sign in|session|manager profile/i.test(message) ? 401 : 503;
    return json({ error: message }, status);
  }
};
