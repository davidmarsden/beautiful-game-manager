const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_ID = process.env.TBG_WORLD_ID || 'tbg-world-001';

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
  if (!response.ok) throw Object.assign(new Error(result.message || result.error || `Supabase returned ${response.status}`), { status: response.status });
  return result;
}

const statusForCode = (code) => ({
  not_invited: 403,
  profile_incomplete: 409,
  manager_profile_missing: 409,
  manager_already_appointed: 409,
  club_not_allowed: 403,
  club_not_found: 404,
  club_taken: 409,
  claim_conflict: 409
}[code] || 400);

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await authenticatedUser(token);

    if (request.method === 'GET') {
      const context = await rpc('get_alpha_claim_context_for_user', { p_user_id: user.id, p_world_id: WORLD_ID });
      return json(context);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const payload = await request.json().catch(() => ({}));
    const clubId = String(payload.club_id || '').trim();
    if (!clubId || clubId.length > 160) return json({ error: 'Choose a valid club', code: 'invalid_club_id' }, 400);

    const result = await rpc('claim_alpha_club_for_user', {
      p_user_id: user.id,
      p_world_id: WORLD_ID,
      p_club_id: clubId
    });
    if (!result?.ok) return json({ error: result?.code || 'Club claim failed', ...result }, statusForCode(result?.code));
    return json(result, 201);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};
