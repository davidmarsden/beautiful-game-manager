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
const runtimeEnv = (key) => globalThis.Netlify?.env?.get?.(key) || '';
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

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

async function recordEmailResult(userId, inviteId, messageId = null, error = null) {
  return rpc('admin_record_alpha_invite_email_delivery', {
    p_admin_user_id: userId,
    p_invite_id: inviteId,
    p_message_id: messageId,
    p_error: error
  });
}

async function sendAlphaInvite({ request, email }) {
  const apiKey = runtimeEnv('RESEND_API_KEY');
  if (!apiKey) throw new Error('Resend is not configured for alpha invitations');
  const from = runtimeEnv('ALPHA_INVITE_FROM') || 'The Beautiful Game <login@auth.thebeautifulgame.online>';
  const portalUrl = runtimeEnv('ALPHA_PORTAL_URL') || `${new URL(request.url).origin}/`;
  const safePortalUrl = escapeHtml(portalUrl);
  const text = `You’re invited to test The Beautiful Game.\n\nTBG is an experimental persistent football management world built around real players, transparent rules and long-term consequences. This is a controlled alpha, so expect rough edges and please try to break things.\n\nOpen the Manager Portal: ${portalUrl}\n\nSign in with this same email address (${email}). Once your profile is complete, you’ll be able to choose from the vacant clubs made available to you.\n\nIf anything looks wrong or confusing, a screenshot is especially useful.\n\n— The Beautiful Game`;
  const html = `<!doctype html><html><body style="margin:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#321824"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #ead6df;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#7b5365;text-transform:uppercase;letter-spacing:.08em">The Beautiful Game</p><h1 style="margin:0 0 18px;font-size:28px;line-height:34px;color:#321824">You’re invited to the controlled alpha</h1><p style="margin:0 0 16px;font-size:16px;line-height:25px;color:#5d4650">TBG is an experimental persistent football management world built around real players, transparent rules and long-term consequences. This is an alpha, so expect rough edges — and please try to break things.</p><p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#5d4650">Sign in with <strong>${escapeHtml(email)}</strong>. Once your profile is complete, you’ll be able to choose from the vacant clubs made available to you.</p><table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#7f1748" style="background-color:#7f1748;border-radius:8px"><a href="${safePortalUrl}" style="display:inline-block;padding:13px 22px;font-size:16px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:bold">Open the Manager Portal</a></td></tr></table><p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#7b5365">If anything looks wrong or confusing, a screenshot is especially useful.</p></td></tr></table></td></tr></table></body></html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'You’re invited to test The Beautiful Game', text, html, tags: [{ name: 'type', value: 'alpha_invite' }] })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(result.message || result.error || `Resend returned ${response.status}`);
  return result.id;
}

async function sendAndTrackInvite({ request, userId, inviteId, email }) {
  try {
    const messageId = await sendAlphaInvite({ request, email });
    await recordEmailResult(userId, inviteId, messageId, null);
    return { email_sent: true, email_message_id: messageId };
  } catch (error) {
    await recordEmailResult(userId, inviteId, null, error.message).catch(() => {});
    return { email_sent: false, email_error: error.message };
  }
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await authenticatedUser(token);

    if (request.method === 'GET') {
      const context = await rpc('get_alpha_admin_context_for_user', { p_user_id: user.id, p_world_id: WORLD_ID });
      if (!context?.ok) return json({ error: context?.code || 'Admin access required', ...context }, 403);
      return json(context);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || '').trim();
    let result;

    if (action === 'invite') {
      const email = String(payload.email || '').trim().toLowerCase();
      const allowedClubIds = Array.isArray(payload.allowed_club_ids)
        ? [...new Set(payload.allowed_club_ids.map((value) => String(value || '').trim()).filter(Boolean))]
        : [];
      if (!email.includes('@')) return json({ error: 'Enter a valid tester email', code: 'invalid_email' }, 400);
      result = await rpc('admin_upsert_alpha_invite', {
        p_admin_user_id: user.id,
        p_world_id: WORLD_ID,
        p_email: email,
        p_allowed_club_ids: allowedClubIds
      });
      if (!result?.ok) return json({ error: result?.code || 'Admin action failed', ...result }, result?.code === 'admin_required' ? 403 : 400);
      return json({ ...result, ...(await sendAndTrackInvite({ request, userId: user.id, inviteId: result.invite_id, email })) });
    }

    if (action === 'resend_invite') {
      const inviteId = String(payload.invite_id || '').trim();
      const context = await rpc('get_alpha_admin_context_for_user', { p_user_id: user.id, p_world_id: WORLD_ID });
      if (!context?.ok) return json({ error: context?.code || 'Admin access required', ...context }, 403);
      const invite = (context.invites || []).find((item) => item.id === inviteId);
      if (!invite) return json({ error: 'invite_not_found', code: 'invite_not_found' }, 404);
      return json({ ok: true, invite_id: inviteId, ...(await sendAndTrackInvite({ request, userId: user.id, inviteId, email: invite.email })) });
    }

    if (action === 'end') {
      result = await rpc('admin_end_alpha_appointment', {
        p_admin_user_id: user.id,
        p_appointment_id: payload.appointment_id,
        p_reason: String(payload.reason || '').trim() || null
      });
    } else if (action === 'reassign') {
      result = await rpc('admin_reassign_alpha_appointment', {
        p_admin_user_id: user.id,
        p_appointment_id: payload.appointment_id,
        p_new_club_id: String(payload.club_id || '').trim(),
        p_reason: String(payload.reason || '').trim() || null
      });
    } else {
      return json({ error: 'Unknown admin action', code: 'unknown_action' }, 400);
    }

    if (!result?.ok) {
      const status = result?.code === 'admin_required' ? 403 : result?.code === 'club_taken' ? 409 : 400;
      return json({ error: result?.code || 'Admin action failed', ...result }, status);
    }
    return json(result);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};
