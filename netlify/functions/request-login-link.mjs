const clean = (value) => String(value || '').trim();
const SUPABASE_URL = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
const SUPABASE_ANON_KEY = clean(process.env.SUPABASE_ANON_KEY);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  }
});

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function allowedRedirect(value, request) {
  const requested = new URL(clean(value) || '/', request.url);
  const origin = new URL(request.url).origin;
  if (requested.origin !== origin) throw new Error('Login redirect must stay on the manager portal');
  return requested.toString();
}

function fetchFailure(error) {
  const code = clean(error?.cause?.code || error?.code);
  const name = clean(error?.cause?.name || error?.name);
  return [error?.message || 'Could not reach Supabase Auth', name, code].filter(Boolean).join(' · ');
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase authentication is not configured' }, 503);

    const body = await request.json().catch(() => ({}));
    const email = clean(body.email).toLowerCase();
    if (!validEmail(email)) return json({ error: 'Enter a valid email address' }, 400);
    const redirectTo = allowedRedirect(body.redirect_to || '/', request);
    const endpoint = new URL('/auth/v1/otp', `${SUPABASE_URL}/`);
    endpoint.searchParams.set('redirect_to', redirectTo);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ email, create_user: true })
      });
    } catch (error) {
      return json({ error: fetchFailure(error) }, 503);
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.msg || result.message || result.error_description || result.error || `Supabase returned ${response.status}` }, response.status);

    return json({ accepted: true });
  } catch (error) {
    return json({ error: error.message || 'Could not send login link' }, 503);
  }
};
