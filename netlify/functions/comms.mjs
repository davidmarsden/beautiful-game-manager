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

async function userRpc(token, name, body) {
  return supabase(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    apiKey: SUPABASE_ANON_KEY,
    bearer: token,
    body: JSON.stringify(body)
  });
}

async function serviceRpc(name, body) {
  return supabase(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    apiKey: SUPABASE_SERVICE_ROLE_KEY,
    bearer: isJwt(SUPABASE_SERVICE_ROLE_KEY) ? SUPABASE_SERVICE_ROLE_KEY : '',
    body: JSON.stringify(body)
  });
}

const cleanUuid = (value) => {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : '';
};

async function threadFor(userId, conversationId) {
  return serviceRpc('get_manager_conversation_for_user', {
    p_user_id: userId,
    p_world_id: WORLD_ID,
    p_conversation_id: conversationId,
    p_limit: 150
  });
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Supabase is not configured' }, 503);
    }

    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await userFor(token);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const conversationId = cleanUuid(url.searchParams.get('conversation'));
      if (conversationId) return json(await threadFor(user.id, conversationId));
      return json(await serviceRpc('get_manager_comms_for_user', {
        p_user_id: user.id,
        p_world_id: WORLD_ID
      }));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();

    if (action === 'start') {
      const otherManagerId = cleanUuid(body.other_manager_id);
      if (!otherManagerId) return json({ error: 'Manager is required' }, 400);
      const conversationId = await userRpc(token, 'start_direct_conversation', {
        p_world_id: WORLD_ID,
        p_other_manager_id: otherManagerId
      });
      return json({ ok: true, conversation_id: conversationId });
    }

    const conversationId = cleanUuid(body.conversation_id);
    if (!conversationId) return json({ error: 'Conversation is required' }, 400);

    if (action === 'send') {
      const message = String(body.message || '').trim();
      const requestKey = String(body.request_key || '').trim();
      if (!message || message.length > 4000 || !requestKey || requestKey.length > 120) {
        return json({ error: 'Message is invalid' }, 400);
      }
      const sent = await userRpc(token, 'send_conversation_message', {
        p_conversation_id: conversationId,
        p_body: message,
        p_request_key: requestKey
      });
      return json({ ok: true, message: sent, conversation: await threadFor(user.id, conversationId) });
    }

    if (action === 'mark-read') {
      const messageSeq = Number(body.message_seq);
      if (!Number.isSafeInteger(messageSeq) || messageSeq < 0) return json({ error: 'Message sequence is invalid' }, 400);
      await userRpc(token, 'mark_conversation_read', {
        p_conversation_id: conversationId,
        p_message_seq: messageSeq
      });
      return json({ ok: true });
    }

    if (action === 'mute') {
      await userRpc(token, 'set_conversation_muted', {
        p_conversation_id: conversationId,
        p_muted: body.muted === true
      });
      return json({ ok: true, muted: body.muted === true });
    }

    if (action === 'block') {
      const otherManagerId = cleanUuid(body.other_manager_id);
      if (!otherManagerId) return json({ error: 'Manager is required' }, 400);
      await userRpc(token, 'set_manager_communication_block', {
        p_world_id: WORLD_ID,
        p_other_manager_id: otherManagerId,
        p_blocked: body.blocked === true
      });
      return json({ ok: true, blocked: body.blocked === true });
    }

    if (action === 'report') {
      const messageId = cleanUuid(body.message_id);
      const reason = String(body.reason || '').trim().toLowerCase();
      const details = String(body.details || '').trim();
      if (!messageId || !['harassment', 'spam', 'abuse', 'other'].includes(reason) || details.length > 1000) {
        return json({ error: 'Report is invalid' }, 400);
      }
      const reportId = await userRpc(token, 'report_conversation_message', {
        p_conversation_id: conversationId,
        p_message_id: messageId,
        p_reason: reason,
        p_details: details || null
      });
      return json({ ok: true, report_id: reportId });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    const message = /Conversation unavailable|Report unavailable|Message unavailable/.test(String(error.message || ''))
      ? 'That conversation is not available.'
      : error.message;
    return json({ error: message }, error.status === 401 ? 401 : 400);
  }
};
