const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, token, ...options }) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const rest = (path, token, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_ANON_KEY,
  token
});

const serviceRest = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { token: SUPABASE_SERVICE_ROLE_KEY } : {})
});

function canonicalFixtureIds(fragment) {
  return new Set(Object.values(fragment?.matchday_cycle?.runtimes || {})
    .flatMap((runtime) => runtime?.fixtures || [])
    .map((fixture) => String(fixture?.fixture_id || ''))
    .filter(Boolean));
}

function filterCurrentMessages(rows, fixtureIds, canonicalCreatedAt) {
  const createdAt = Date.parse(canonicalCreatedAt || 0);
  return (rows || []).filter((message) => {
    if (message.related_fixture_id) return fixtureIds.has(String(message.related_fixture_id));
    return Number.isFinite(createdAt) && Date.parse(message.created_at) >= createdAt;
  });
}

export default async (request) => {
  if (!['GET', 'PATCH'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
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

    if (request.method === 'GET') {
      const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
      const appointment = appointments[0];
      if (!appointment) return json({ messages: [], unread_count: 0 });

      const [rawMessages, canonicalRows] = await Promise.all([
        rest(`/rest/v1/manager_messages?recipient_manager_id=eq.${encodeURIComponent(manager.id)}&select=id,message_type,subject,body,priority,created_at,read_at,related_fixture_id&order=created_at.desc&limit=100`, token),
        serviceRest(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_checksum,created_at&limit=1`)
      ]);

      const canonical = canonicalRows[0];
      if (!canonical) return json({ error: `Canonical world ${appointment.world_id} has not been initialized`, code: 'canonical_world_not_initialized' }, 409);

      const cacheRows = await serviceRest(`/rest/v1/manager_portal_fragment_cache?world_id=eq.${encodeURIComponent(appointment.world_id)}&club_id=eq.${encodeURIComponent(appointment.club_id)}&source_checksum=eq.${encodeURIComponent(canonical.save_checksum)}&select=source_checksum,fragment&limit=1`);
      const cache = cacheRows[0];
      if (!cache?.fragment) return json({ error: 'Canonical portal fragment is not ready yet', code: 'canonical_portal_fragment_not_ready' }, 503);

      const messages = filterCurrentMessages(rawMessages, canonicalFixtureIds(cache.fragment), canonical.created_at);
      return json({
        messages,
        unread_count: messages.filter((message) => !message.read_at).length
      });
    }

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
