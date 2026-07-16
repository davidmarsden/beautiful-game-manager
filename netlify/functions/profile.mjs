const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const payload = await request.json();
    const displayName = String(payload.display_name || '').trim();
    if (displayName.length < 2 || displayName.length > 80) return json({ error: 'Enter your real manager name' }, 400);

    const update = {
      display_name: displayName,
      country: String(payload.country || '').trim() || null,
      timezone: String(payload.timezone || '').trim() || 'Europe/London',
      favourite_club: String(payload.favourite_club || '').trim() || null,
      profile_completed: true,
      updated_at: new Date().toISOString()
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: JSON.stringify(update)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.message || `Supabase returned ${response.status}` }, response.status);
    return json({ saved: true, manager: Array.isArray(result) ? result[0] : result });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
