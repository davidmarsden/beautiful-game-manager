const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PLAYER_DATABASE_URL = process.env.TBG_PLAYER_DATABASE_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-database/player-database.json';
const isJwt = (value) => String(value || '').split('.').length === 3;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function supabase(path, { service = false, token = '' } = {}) {
  const apiKey = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const bearer = service && isJwt(SUPABASE_SERVICE_ROLE_KEY) ? SUPABASE_SERVICE_ROLE_KEY : token;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      accept: 'application/json'
    }
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
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, { token });
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id&limit=1`, { token });
  if (!appointments[0]) throw new Error('No active club appointment');
  return appointments[0];
}

function normalise(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function rowName(row = {}) {
  return row.player_name || row.display_name || row.full_name || row.short_name || '';
}

function tmIdOf(row = {}) {
  return String(row.transfermarkt_id || row.transfermarkt_player_id || '').trim();
}

function ratingOf(row = {}) {
  const rating = Number(row.tbg_rating ?? row.underlying_ability_rating ?? 0);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function canonicalId(row = {}, tmId = '') {
  return String(row.tbg_player_id || `tbg-tm-${String(tmId).padStart(8, '0')}`);
}

function scoreName(name, query) {
  const normalized = normalise(name);
  if (!normalized) return 99;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.split(' ').some((token) => token.startsWith(query))) return 2;
  return normalized.includes(query) ? 3 : 99;
}

async function freshWorldPlayers(worldId) {
  const encoded = encodeURIComponent(worldId);
  const [cacheRows, canonicalRows] = await Promise.all([
    supabase(`/rest/v1/world_read_model_cache?world_id=eq.${encoded}&select=read_model,source_checksum&limit=1`, { service: true }),
    supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encoded}&select=save_checksum&limit=1`, { service: true })
  ]);
  const cacheRow = cacheRows[0];
  const canonicalRow = canonicalRows[0];
  if (!cacheRow?.read_model || !canonicalRow?.save_checksum || cacheRow.source_checksum !== canonicalRow.save_checksum) {
    throw new Error('World read model is refreshing; please retry shortly');
  }
  const players = cacheRow.read_model?.squad_cycle?.players;
  if (!players || typeof players !== 'object' || Array.isArray(players)) {
    throw new Error('World read model is refreshing; please retry shortly');
  }
  return players;
}

function inWorld(players, row, tmId) {
  const id = canonicalId(row, tmId);
  if (players[id]) return true;
  return Object.values(players).some((candidate) =>
    tmId && String(candidate?.transfermarkt_id || candidate?.transfermarktId || '').trim() === tmId
  );
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const appointment = await identity(token);
    const url = new URL(request.url);
    const rawQuery = String(url.searchParams.get('q') || '').trim();
    const query = normalise(rawQuery);
    if (query.length < 2) return json({ error: 'Enter at least two characters of the player name' }, 400);
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 12));

    const [databaseResponse, worldPlayers] = await Promise.all([
      fetch(PLAYER_DATABASE_URL, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, cache: 'no-store' }),
      freshWorldPlayers(appointment.world_id)
    ]);
    if (!databaseResponse.ok) throw new Error(`Player database unavailable (HTTP ${databaseResponse.status})`);
    const database = await databaseResponse.json();
    const rows = Array.isArray(database) ? database : [];

    const matches = rows
      .map((row) => ({ row, tmId: tmIdOf(row), name: rowName(row), score: scoreName(rowName(row), query) }))
      .filter(({ tmId, score }) => tmId && score < 99)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .slice(0, limit)
      .map(({ row, tmId }) => ({
        tbg_player_id: canonicalId(row, tmId),
        transfermarkt_id: tmId,
        display_name: rowName(row) || canonicalId(row, tmId),
        age: row.age == null ? null : Number(row.age),
        nationality: Array.isArray(row.nationality) ? row.nationality : String(row.nationality || '').split(';').map((value) => value.trim()).filter(Boolean),
        position: row.position || row.primary_position || row.position_group || '',
        tbg_rating: ratingOf(row),
        market_value_eur: Math.max(0, Number(row.market_value_eur) || 0),
        real_world_club: row.current_club || '',
        status: row.status || 'active',
        in_world: inWorld(worldPlayers, row, tmId),
        governed_rating_available: Boolean(ratingOf(row))
      }));

    return json({ query: rawQuery, results: matches, count: matches.length });
  } catch (error) {
    const message = String(error?.message || 'External player search failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /refreshing|unavailable/i.test(message) ? 503 : 500;
    return json({ error: message }, status);
  }
};
