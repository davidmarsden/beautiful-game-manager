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
const cleanType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  return ['player', 'club', 'fixture', 'news'].includes(type) ? type : '';
};
const cleanId = (value) => String(value || '').trim().slice(0, 240);
const cleanTitle = (value) => String(value || '').trim().slice(0, 240);

async function supabase(path, { apiKey, bearer, ...options } = {}) {
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
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Supabase returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function userFor(token) {
  return supabase('/auth/v1/user', { apiKey: SUPABASE_ANON_KEY, bearer: token });
}

async function rpc(name, body) {
  return supabase(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    apiKey: SUPABASE_SERVICE_ROLE_KEY,
    bearer: isJwt(SUPABASE_SERVICE_ROLE_KEY) ? SUPABASE_SERVICE_ROLE_KEY : '',
    body: JSON.stringify(body)
  });
}

function objectPayload(body = {}) {
  const objectType = cleanType(body.object_type);
  const objectId = cleanId(body.object_id);
  const objectTitle = cleanTitle(body.object_title);
  if (!objectType || !objectId || !objectTitle) throw Object.assign(new Error('Object discussion is unavailable'), { status: 400 });
  return { objectType, objectId, objectTitle };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await userFor(token);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const { objectType, objectId, objectTitle } = objectPayload({
        object_type: url.searchParams.get('type'),
        object_id: url.searchParams.get('id'),
        object_title: url.searchParams.get('title')
      });
      return json(await rpc('get_object_discussion_for_user', {
        p_user_id: user.id,
        p_world_id: WORLD_ID,
        p_object_type: objectType,
        p_object_id: objectId,
        p_object_title: objectTitle
      }));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    if (action !== 'comment') return json({ error: 'Unknown action' }, 400);

    const { objectType, objectId, objectTitle } = objectPayload(body);
    const commentBody = String(body.body || '').trim();
    if (!commentBody || commentBody.length > 2000) return json({ error: 'Comment must be between 1 and 2000 characters' }, 400);

    await rpc('create_object_discussion_comment_for_user', {
      p_user_id: user.id,
      p_world_id: WORLD_ID,
      p_object_type: objectType,
      p_object_id: objectId,
      p_object_title: objectTitle,
      p_body: commentBody,
      p_parent_comment_id: body.parent_comment_id || null
    });

    const discussion = await rpc('get_object_discussion_for_user', {
      p_user_id: user.id,
      p_world_id: WORLD_ID,
      p_object_type: objectType,
      p_object_id: objectId,
      p_object_title: objectTitle
    });
    return json({ ok: true, discussion }, 201);
  } catch (error) {
    const message = String(error?.message || 'Object discussion is unavailable');
    const status = error.status === 401 ? 401
      : /unavailable|between 1|reply target/i.test(message) ? 400
      : 503;
    return json({ error: message }, status);
  }
};
