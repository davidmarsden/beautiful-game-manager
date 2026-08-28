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
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || `Supabase returned ${response.status}`);
  return result;
}

function absoluteActionUrl(actionUrl) {
  const base = runtimeEnv('NOTIFICATION_PORTAL_URL') || runtimeEnv('ALPHA_PORTAL_URL') || 'https://thebeautifulgame.online/';
  try { return new URL(actionUrl || '/', base).toString(); }
  catch { return base; }
}

function isDigest(items) {
  return items[0]?.email_frequency === 'daily';
}

function renderEmail(items) {
  const digest = isDigest(items);
  const subject = digest ? `Your TBG update · ${items.length} notification${items.length === 1 ? '' : 's'}` : `[TBG] ${items[0]?.title || 'Manager notification'}`;
  const textRows = items.map((item) => `${item.title}\n${item.body || ''}\n${absoluteActionUrl(item.action_url)}`).join('\n\n');
  const text = `${digest ? 'Here’s what happened in The Beautiful Game:' : 'Something happened in The Beautiful Game:'}\n\n${textRows}\n\nChange email delivery in Manager Portal → Notifications → Settings.`;
  const rows = items.map((item) => `<tr><td style="padding:16px 0;border-top:1px solid #ead6df"><strong style="display:block;font-size:16px;line-height:22px;color:#321824">${escapeHtml(item.title)}</strong><p style="margin:6px 0 12px;font-size:14px;line-height:22px;color:#5d4650">${escapeHtml(item.body || '')}</p><a href="${escapeHtml(absoluteActionUrl(item.action_url))}" style="font-size:14px;line-height:20px;color:#7f1748;font-weight:bold;text-decoration:none">Open in Manager Portal →</a></td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#321824"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 16px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #ead6df;border-radius:16px"><tr><td style="padding:28px 32px"><p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#7b5365;text-transform:uppercase;letter-spacing:.08em">The Beautiful Game</p><h1 style="margin:0 0 16px;font-size:24px;line-height:30px;color:#321824">${digest ? 'Your manager update' : escapeHtml(items[0]?.title || 'Manager notification')}</h1><table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table><p style="margin:20px 0 0;font-size:12px;line-height:19px;color:#7b5365">You asked TBG to send these notifications by email. Change delivery frequency or categories in Manager Portal → Notifications → Settings.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendEmail(email, items) {
  const apiKey = runtimeEnv('RESEND_API_KEY');
  if (!apiKey) throw new Error('Resend is not configured for manager notifications');
  if (!email) throw new Error('Manager email address is unavailable');
  const from = runtimeEnv('NOTIFICATION_EMAIL_FROM') || runtimeEnv('ALPHA_INVITE_FROM') || 'The Beautiful Game <login@auth.thebeautifulgame.online>';
  const message = renderEmail(items);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: message.subject,
      text: message.text,
      html: message.html,
      tags: [
        { name: 'type', value: 'manager_notification' },
        { name: 'frequency', value: isDigest(items) ? 'daily' : 'instant' }
      ]
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(result.message || result.error || `Resend returned ${response.status}`);
  return result.id;
}

function deliveryGroups(rows) {
  const groups = [];
  const daily = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.email_frequency === 'daily') {
      const key = `${row.manager_id}|${row.world_id || ''}|${row.email || ''}`;
      if (!daily.has(key)) daily.set(key, []);
      daily.get(key).push(row);
    } else {
      groups.push([row]);
    }
  }
  groups.push(...daily.values());
  return groups;
}

export default async () => {
  const claimToken = randomUUID();
  const claimed = await rpc('claim_manager_notification_email_deliveries', { p_claim_token: claimToken, p_limit: 100 });
  for (const items of deliveryGroups(claimed)) {
    const notificationIds = items.map((item) => item.notification_id);
    try {
      await rpc('start_manager_notification_email_deliveries', {
        p_claim_token: claimToken,
        p_notification_ids: notificationIds
      });
      const messageId = await sendEmail(items[0]?.email, items);
      await rpc('finish_manager_notification_email_deliveries', {
        p_claim_token: claimToken,
        p_notification_ids: notificationIds,
        p_message_id: messageId,
        p_error: null
      });
    } catch (error) {
      await rpc('finish_manager_notification_email_deliveries', {
        p_claim_token: claimToken,
        p_notification_ids: notificationIds,
        p_message_id: null,
        p_error: error.message
      }).catch(() => null);
    }
  }
};

export const config = {
  schedule: '*/5 * * * *'
};
