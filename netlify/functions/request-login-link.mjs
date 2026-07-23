const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  }
});

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function allowedRedirect(value, request) {
  const requested = new URL(String(value || '/'), request.url);
  const origin = new URL(request.url).origin;
  if (requested.origin !== origin) throw new Error('Login redirect must stay on the manager portal');
  return requested.toString();
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase authentication is not configured' }, 503);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!validEmail(email)) return json({ error: 'Enter a valid email address' }, 400);
    const redirectTo = allowedRedirect(body.redirect_to || '/', request);

    const response = await fetch(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, create_user: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.msg || result.message || result.error_description || result.error || `Supabase returned ${response.status}` }, response.status);

    return json({ accepted: true });
  } catch (error) {
    return json({ error: error.message || 'Could not send login link' }, 503);
  }
};
