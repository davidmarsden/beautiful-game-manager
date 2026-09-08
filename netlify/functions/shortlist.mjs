const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_ID = process.env.TBG_WORLD_ID || 'tbg-world-1';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

const isJwt = (value) => String(value || '').split('.').length === 3;

async function authenticatedUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw Object.assign(new Error('Session is invalid or expired'), { status: 401 });
  return response.json();
}

async function rpc(name, body) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    'content-type': 'application/json',
    accept: 'application/json'
  };
  if (isJwt(SUPABASE_SERVICE_ROLE_KEY)) headers.authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(result.message || result.error || `Supabase returned ${response.status}`), { status: response.status });
  }
  return result;
}

function safeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['display_name','position','age','rating','club_name','asking_fee','nationality','market_value_eur','transfermarkt_id','contract_label'];
  const output = {};
  for (const key of allowed) {
    if (value[key] === undefined || value[key] === null) continue;
    if (Array.isArray(value[key])) output[key] = value[key].slice(0, 8).map((item) => String(item).slice(0, 100));
    else output[key] = typeof value[key] === 'number' ? value[key] : String(value[key]).slice(0, 240);
  }
  return output;
}

function statusFor(result) {
  if (result?.ok) return 200;
  if (result?.code === 'manager_profile_missing') return 403;
  if (result?.code === 'player_id_required' || result?.code === 'note_too_long') return 400;
  return 400;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await authenticatedUser(token);

    if (request.method === 'GET') {
      const result = await rpc('get_manager_shortlist_for_user', {
        p_user_id: user.id,
        p_world_id: WORLD_ID
      });
      return json(result, statusFor(result));
    }

    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || 'upsert');
    const playerId = String(payload.player_id || '').trim();

    if (action === 'remove') {
      const result = await rpc('remove_manager_shortlist_for_user', {
        p_user_id: user.id,
        p_world_id: WORLD_ID,
        p_player_id: playerId
      });
      return json(result, statusFor(result));
    }

    if (action !== 'upsert') return json({ error: 'Unsupported shortlist action' }, 400);

    const result = await rpc('upsert_manager_shortlist_for_user', {
      p_user_id: user.id,
      p_world_id: WORLD_ID,
      p_player_id: playerId,
      p_source_type: String(payload.source_type || 'unknown'),
      p_player_snapshot: safeSnapshot(payload.player_snapshot),
      p_note: payload.note === undefined ? null : String(payload.note).slice(0, 1001)
    });
    return json(result, statusFor(result));
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};
