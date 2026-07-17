const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => { const value = request.headers.get('authorization') || ''; return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''; };
const text = (value) => String(value ?? '').trim();

async function rest(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.hint || `Supabase returned ${response.status}`);
  return body;
}

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const user = await response.json();
  const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  return profiles[0] || null;
}

function validateSheet(payload) {
  const errors = [];
  const name = text(payload.name);
  if (!name || name.length > 60) errors.push('Preset name must be between 1 and 60 characters');
  if (!text(payload.club_id)) errors.push('Club is required');
  if (!text(payload.formation)) errors.push('Formation is required');
  if (!Array.isArray(payload.starting_xi) || payload.starting_xi.length !== 11) errors.push('A preset must contain exactly 11 starters');
  if (!Array.isArray(payload.bench) || payload.bench.length > 12) errors.push('Bench must be an array of no more than 12 players');
  const all = [...(payload.starting_xi || []), ...(payload.bench || [])].map(String);
  if (new Set(all).size !== all.length) errors.push('A player cannot appear twice');
  if (payload.captain_id && !payload.starting_xi?.map(String).includes(String(payload.captain_id))) errors.push('Captain must be in the starting XI');
  if (errors.length) { const error = new Error(errors.join(' · ')); error.status = 400; throw error; }
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const manager = await identity(token);
    if (!manager) return json({ error: 'Manager profile not found' }, 403);

    const url = new URL(request.url);
    if (request.method === 'GET') {
      const clubId = text(url.searchParams.get('club_id'));
      if (!clubId) return json({ error: 'club_id is required' }, 400);
      const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(clubId)}&status=eq.active&select=id&limit=1`, token);
      if (!appointments[0]) return json({ error: 'You are not appointed to this club' }, 403);
      const presets = await rest(`/rest/v1/team_sheet_presets?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(clubId)}&select=*&order=updated_at.desc`, token);
      return json({ presets });
    }

    if (request.method === 'POST') {
      const payload = await request.json();
      validateSheet(payload);
      const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id&limit=1`, token);
      if (!appointments[0]) return json({ error: 'You are not appointed to this club' }, 403);
      const row = {
        manager_id: manager.id,
        club_id: payload.club_id,
        name: text(payload.name),
        formation: payload.formation,
        starting_xi: payload.starting_xi.map(String),
        bench: (payload.bench || []).map(String),
        captain_id: payload.captain_id || null,
        set_piece_takers: payload.set_piece_takers || {},
        tactics: payload.tactics || {},
        updated_at: new Date().toISOString()
      };
      const saved = await rest('/rest/v1/team_sheet_presets?on_conflict=manager_id,club_id,name', token, {
        method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row)
      });
      return json({ preset: saved[0] || row }, 200);
    }

    if (request.method === 'DELETE') {
      const presetId = text(url.searchParams.get('id'));
      if (!presetId) return json({ error: 'Preset id is required' }, 400);
      await rest(`/rest/v1/team_sheet_presets?id=eq.${encodeURIComponent(presetId)}&manager_id=eq.${encodeURIComponent(manager.id)}`, token, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      return json({ deleted: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};