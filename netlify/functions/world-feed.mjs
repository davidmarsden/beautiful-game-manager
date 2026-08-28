const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, bearer, ...options } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

const serviceSupabase = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
});

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  return response.json();
}

async function activeAppointment(userId) {
  const profiles = await serviceSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await serviceSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`);
  if (!appointments[0]) throw new Error('No active club appointment');
  return appointments[0];
}

async function rpc(name, body) {
  return serviceSupabase(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function systemFeedSignature(worldId) {
  const rows = await serviceSupabase(`/rest/v1/world_feed_items?world_id=eq.${encodeURIComponent(worldId)}&source_key=not.is.null&select=id,source_key,item_type,title,body,metadata,hidden_at,pinned_at&order=id.asc`);
  return JSON.stringify(rows);
}

const timestamp = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

function compareFeedItems(left, right) {
  const leftPinned = Boolean(left?.pinned_at);
  const rightPinned = Boolean(right?.pinned_at);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  if (leftPinned && rightPinned) {
    const pinDelta = timestamp(right.pinned_at) - timestamp(left.pinned_at);
    if (pinDelta) return pinDelta;
  }

  const activityDelta = timestamp(right?.activity_at || right?.created_at) - timestamp(left?.activity_at || left?.created_at);
  if (activityDelta) return activityDelta;

  if (left?.item_type === 'matchday_completed' && right?.item_type === 'matchday_completed') {
    const matchdayDelta = Number(right?.metadata?.matchday || 0) - Number(left?.metadata?.matchday || 0);
    if (matchdayDelta) return matchdayDelta;
  }

  const createdDelta = timestamp(right?.created_at) - timestamp(left?.created_at);
  if (createdDelta) return createdDelta;
  return String(right?.id || '').localeCompare(String(left?.id || ''));
}

async function currentFeed(userId, worldId) {
  const feed = await rpc('get_manager_world_feed_for_user', {
    p_user_id: userId,
    p_world_id: worldId,
    p_limit: 60
  });
  if (Array.isArray(feed?.items)) feed.items.sort(compareFeedItems);
  return feed;
}

async function bestEffortFeedItem(userId, worldId, itemId) {
  try {
    const feed = await currentFeed(userId, worldId);
    return (feed?.items || []).find((candidate) => String(candidate.id) === String(itemId)) || null;
  } catch {
    return null;
  }
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await identity(token);
    const appointment = await activeAppointment(user.id);

    if (request.method === 'GET') {
      // Reads must stay fast: system projection reconciliation and social metrics
      // are explicit background actions rather than prerequisites for first paint.
      return json(await currentFeed(user.id, appointment.world_id));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || '').trim().toLowerCase();

    if (action === 'sync') {
      const before = await systemFeedSignature(appointment.world_id);
      await rpc('sync_world_feed_system_items', { p_world_id: appointment.world_id });
      const after = await systemFeedSignature(appointment.world_id);
      return json({ changed: before !== after });
    }
    if (action === 'activity') {
      return json(await rpc('get_world_feed_social_activity_for_user', {
        p_user_id: user.id,
        p_world_id: appointment.world_id,
        p_days: 30
      }));
    }
    if (action === 'post') {
      const result = await rpc('create_manager_world_feed_post_for_user', {
        p_user_id: user.id,
        p_world_id: appointment.world_id,
        p_body: payload.body
      });
      const item = await bestEffortFeedItem(user.id, appointment.world_id, result?.id);
      return json({ ...result, item }, 201);
    }
    if (action === 'comment') {
      const result = await rpc('create_manager_world_feed_comment_for_user', {
        p_user_id: user.id,
        p_world_id: appointment.world_id,
        p_feed_item_id: payload.feed_item_id,
        p_body: payload.body,
        p_parent_comment_id: payload.parent_comment_id || null
      });
      const item = await bestEffortFeedItem(user.id, appointment.world_id, payload.feed_item_id);
      return json({ ...result, item }, 201);
    }
    if (action === 'pin') {
      const result = await rpc('set_world_feed_item_pinned_for_user', {
        p_user_id: user.id,
        p_world_id: appointment.world_id,
        p_feed_item_id: payload.feed_item_id,
        p_pinned: Boolean(payload.pinned)
      });
      const item = await bestEffortFeedItem(user.id, appointment.world_id, payload.feed_item_id);
      return json({ ...result, item });
    }
    if (action === 'hide') {
      const result = await rpc('hide_world_feed_item_for_user', {
        p_user_id: user.id,
        p_world_id: appointment.world_id,
        p_feed_item_id: payload.feed_item_id
      });
      return json(result);
    }
    return json({ error: 'Unknown World Feed action' }, 400);
  } catch (error) {
    const message = String(error?.message || 'Could not load World Feed');
    const status = /Session|Authentication/.test(message) ? 401
      : /appointment|profile/i.test(message) ? 409
      : /Administrator|only hide your own/i.test(message) ? 403
      : /between 1|unavailable|not found|reply target/i.test(message) ? 400
      : 503;
    return json({ error: message }, status);
  }
};
