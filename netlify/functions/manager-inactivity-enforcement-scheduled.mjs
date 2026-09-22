import { randomUUID } from 'node:crypto';

const runtimeEnv = (key) => globalThis.Netlify?.env?.get?.(key) || process.env[key] || '';
const isJwt = (value) => String(value || '').split('.').length === 3;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function rpc(name, body) {
  const base = runtimeEnv('SUPABASE_URL');
  const key = runtimeEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Supabase is not configured');
  const headers = { apikey: key, accept: 'application/json', 'content-type': 'application/json' };
  if (isJwt(key)) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || `Supabase returned ${response.status}`);
  return result;
}

function portalUrl() {
  return runtimeEnv('ALPHA_PORTAL_URL') || runtimeEnv('NOTIFICATION_PORTAL_URL') || 'https://thebeautifulgame.online/';
}

function firstName(displayName) {
  const clean = String(displayName || '').trim();
  if (!clean) return 'there';
  if (/^[a-z0-9_.-]+$/i.test(clean)) return clean;
  return clean.split(/\s+/)[0];
}

function messageFor(item) {
  const name = firstName(item.display_name);
  const club = item.club_name || 'your club';
  const portal = portalUrl();

  if (item.stage === 'removal') {
    const subject = `TBG participation — ${club} is now vacant`;
    const text = `Hi ${name},

You have now been inactive in The Beautiful Game Manager Portal for 10 days. The 3-day participation warning was not cleared by returning to the portal, so your appointment at ${club} has ended under the published controlled-alpha participation rule.

The club is now available for a replacement manager. Your manager profile and career record remain, and you have returned to the reappointment pool.

If you want to take part again, you can still sign in here:
${portal}

Thanks for the time you've put into the alpha.

David
The Beautiful Game`;
    const html = `<!doctype html><html><body style="margin:0;background:#f7f7f2;font-family:Arial,Helvetica,sans-serif;color:#1e2a22"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 16px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #d7ddd8;border-radius:14px"><tr><td style="padding:30px 32px"><p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#587063;text-transform:uppercase;letter-spacing:.08em">The Beautiful Game</p><h1 style="margin:0 0 18px;font-size:24px;line-height:31px;color:#163d28">Your club appointment has ended</h1><p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#26352d">Hi ${escapeHtml(name)},</p><p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#26352d">You have now been inactive in the Manager Portal for <strong>10 days</strong>. The earlier participation warning was not cleared by returning, so your appointment at <strong>${escapeHtml(club)}</strong> has ended under the published controlled-alpha participation rule.</p><p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#26352d">The club is now available for a replacement manager. Your manager profile and career record remain, and you have returned to the reappointment pool.</p><table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffd923" style="background-color:#ffd923;border:1px solid #173c29"><a href="${escapeHtml(portal)}" style="display:inline-block;padding:12px 18px;font-size:14px;line-height:20px;color:#173c29;font-weight:bold;text-decoration:none">Open Manager Portal →</a></td></tr></table><p style="margin:18px 0 0;font-size:14px;line-height:22px;color:#26352d">Thanks for the time you've put into the alpha.<br><br>David<br>The Beautiful Game</p></td></tr></table></td></tr></table></body></html>`;
    return { subject, text, html };
  }

  const subject = `TBG participation — ${club} is in caretaker status`;
  const text = `Hi ${name},

You have now been inactive in The Beautiful Game Manager Portal for 7 days, so ${club} has entered caretaker status under the published controlled-alpha participation rule.

Nothing is final yet. Log back in before you reach 10 days of inactivity and caretaker status will clear automatically:
${portal}

If inactivity reaches 10 days, your appointment will end and the club will become available for a replacement manager.

David
The Beautiful Game`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f2;font-family:Arial,Helvetica,sans-serif;color:#1e2a22"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 16px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #d7ddd8;border-radius:14px"><tr><td style="padding:30px 32px"><p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#587063;text-transform:uppercase;letter-spacing:.08em">The Beautiful Game</p><h1 style="margin:0 0 18px;font-size:24px;line-height:31px;color:#163d28">Caretaker status</h1><p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#26352d">Hi ${escapeHtml(name)},</p><p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#26352d">You have now been inactive in the Manager Portal for <strong>7 days</strong>, so <strong>${escapeHtml(club)}</strong> has entered caretaker status.</p><p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#26352d">Nothing is final yet. Log back in before 10 days of inactivity and caretaker status will clear automatically. At 10 days, the appointment ends and the club becomes available for a replacement manager.</p><table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffd923" style="background-color:#ffd923;border:1px solid #173c29"><a href="${escapeHtml(portal)}" style="display:inline-block;padding:12px 18px;font-size:14px;line-height:20px;color:#173c29;font-weight:bold;text-decoration:none">Return to your club →</a></td></tr></table><p style="margin:18px 0 0;font-size:14px;line-height:22px;color:#26352d">David<br>The Beautiful Game</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendEmail(item) {
  const apiKey = runtimeEnv('RESEND_API_KEY');
  if (!apiKey) throw new Error('Resend is not configured');
  if (!item.email) throw new Error('Manager email address is unavailable');
  const from = runtimeEnv('NOTIFICATION_EMAIL_FROM') || runtimeEnv('ALPHA_INVITE_FROM') || 'The Beautiful Game <login@auth.thebeautifulgame.online>';
  const message = messageFor(item);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'Idempotency-Key': `manager-inactivity-${item.escalation_id}`
    },
    body: JSON.stringify({
      from,
      to: [item.email],
      subject: message.subject,
      text: message.text,
      html: message.html,
      tags: [
        { name: 'type', value: `manager_inactivity_${item.stage}` },
        { name: 'world', value: String(item.world_id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }
      ]
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(result.message || result.error || `Resend returned ${response.status}`);
  return result.id;
}

export default async () => {
  const claimToken = randomUUID();
  const rows = await rpc('claim_manager_inactivity_escalations', { p_claim_token: claimToken, p_limit: 100 });
  for (const item of Array.isArray(rows) ? rows : []) {
    try {
      const messageId = await sendEmail(item);
      await rpc('finish_manager_inactivity_escalation', {
        p_claim_token: claimToken,
        p_escalation_id: item.escalation_id,
        p_message_id: messageId,
        p_error: null
      });
    } catch (error) {
      await rpc('finish_manager_inactivity_escalation', {
        p_claim_token: claimToken,
        p_escalation_id: item.escalation_id,
        p_message_id: null,
        p_error: error.message
      }).catch(() => null);
    }
  }
};

export const config = {
  schedule: '30 * * * *'
};
