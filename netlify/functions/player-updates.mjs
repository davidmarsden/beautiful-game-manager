const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PLAYER_RELEASE_URL = process.env.TBG_PLAYER_RELEASE_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-changes/player-release-latest.json';
const PLAYER_RELEASE_CACHE_MS = Math.max(5000, Number(process.env.TBG_PLAYER_RELEASE_CACHE_MS) || 30000);

let releasePromise = null;
let releaseLoadedAt = 0;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function requireManager(token) {
  if (!token) throw new Error('Sign in to view player updates.');
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Unable to verify manager profile');
  const profiles = await response.json();
  if (!profiles[0]) throw new Error('Manager profile has not been created yet');
}

async function latestRelease() {
  const fresh = releasePromise && Date.now() - releaseLoadedAt < PLAYER_RELEASE_CACHE_MS;
  if (!fresh) {
    releaseLoadedAt = Date.now();
    releasePromise = fetch(PLAYER_RELEASE_URL, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      cache: 'no-store'
    }).then(async (response) => {
      if (response.status === 404) {
        return {
          version: 'tbg-player-release-latest-v1',
          release: null,
          ratings_updates: [],
          new_players: [],
          other_updates: [],
          pending_eligible: 0
        };
      }
      if (!response.ok) throw new Error(`Player updates unavailable (HTTP ${response.status})`);
      return response.json();
    }).catch((error) => {
      releasePromise = null;
      releaseLoadedAt = 0;
      throw error;
    });
  }
  return releasePromise;
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    await requireManager(bearerToken(request));
    const release = await latestRelease();
    return json(release);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load player updates';
    const status = /sign in|session|manager profile/i.test(message) ? 401 : 503;
    return json({ error: message }, status);
  }
};
