const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function rest(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Supabase returned ${response.status}`);
  return body;
}

export default async (request) => {
  if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();

    const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile has not been created yet' }, 403);

    const payload = await request.json().catch(() => ({}));
    const messageId = String(payload.message_id || '').trim();
    const markAll = payload.mark_all === true;
    if (!messageId && !markAll) return json({ error: 'message_id or mark_all is required' }, 400);

    const now = new Date().toISOString();
    const filter = markAll
      ? `recipient_manager_id=eq.${encodeURIComponent(manager.id)}&read_at=is.null`
      : `id=eq.${encodeURIComponent(messageId)}&recipient_manager_id=eq.${encodeURIComponent(manager.id)}`;

    const updated = await rest(`/rest/v1/manager_messages?${filter}`, token, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ read_at: now })
    });

    const unread = await rest(`/rest/v1/manager_messages?recipient_manager_id=eq.${encodeURIComponent(manager.id)}&read_at=is.null&select=id`, token);

    return json({
      ok: true,
      marked: updated.length,
      read_at: now,
      unread_count: unread.length,
      message_ids: updated.map((message) => message.id)
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
