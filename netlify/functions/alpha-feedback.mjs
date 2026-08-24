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
const CLIENT_CONTEXT_LIMIT = 8192;
const CLIENT_CONTEXT_FIELDS = {
  path: 1000,
  page_area: 500,
  user_agent: 1200,
  viewport: 64,
  language: 64,
  local_time: 64
};

async function authenticatedUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw Object.assign(new Error('Session is invalid or expired'), { status: 401 });
  return response.json();
}

async function rpc(name, body) {
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', accept: 'application/json' };
  if (isJwt(SUPABASE_SERVICE_ROLE_KEY)) headers.authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || result.error || `Supabase returned ${response.status}`), { status: response.status });
  return result;
}

function boundedClientContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw Object.assign(new Error('Client context is invalid'), { status: 400 });
  }
  if (serialized.length > CLIENT_CONTEXT_LIMIT) {
    throw Object.assign(new Error('Client context is too large'), { status: 400 });
  }
  const result = {};
  for (const [key, maxLength] of Object.entries(CLIENT_CONTEXT_FIELDS)) {
    if (value[key] === undefined || value[key] === null) continue;
    result[key] = String(value[key]).slice(0, maxLength);
  }
  return result;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await authenticatedUser(token);
    const payload = await request.json().catch(() => ({}));
    const clientContext = boundedClientContext(payload.client_context);

    const result = await rpc('submit_alpha_feedback_for_user', {
      p_user_id: user.id,
      p_world_id: WORLD_ID,
      p_kind: String(payload.kind || '').trim(),
      p_category: String(payload.category || '').trim(),
      p_page_area: String(payload.page_area || '').trim() || null,
      p_action_taken: String(payload.action_taken || '').trim() || null,
      p_expected_result: String(payload.expected_result || '').trim() || null,
      p_actual_result: String(payload.actual_result || '').trim() || null,
      p_note: String(payload.note || '').trim() || null,
      p_client_context: clientContext
    });

    if (!result?.ok) {
      const status = result?.code === 'rate_limited' ? 429 : result?.code === 'manager_profile_missing' ? 403 : 400;
      return json({ error: result?.code || 'Feedback could not be saved', ...result }, status);
    }
    return json(result, 201);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};
