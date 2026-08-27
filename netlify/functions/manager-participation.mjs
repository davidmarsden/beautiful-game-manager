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
const cleanText = (value) => String(value || '').trim().slice(0, 240) || null;

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

async function activeContext(userId) {
  const profiles = await serviceSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`);
  if (!profiles[0]) throw new Error('Manager profile has not been created yet');
  const appointments = await serviceSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(profiles[0].id)}&status=eq.active&select=world_id&limit=1`);
  if (!appointments[0]) throw new Error('No active club appointment');
  return { managerId: profiles[0].id, worldId: appointments[0].world_id };
}

async function clubNamesForWorld(userId, worldId) {
  try {
    const result = await serviceSupabase('/rest/v1/rpc/get_manager_transfer_directory_for_user', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: userId, p_world_id: worldId })
    });
    const clubs = Array.isArray(result?.directory?.clubs) ? result.directory.clubs : [];
    return new Map(clubs.map((club) => [String(club.club_id || ''), club.club_name || club.club_id]).filter(([id]) => id));
  } catch {
    return new Map();
  }
}

async function managerDirectory(worldId, selfId, userId) {
  const appointments = await serviceSupabase(`/rest/v1/manager_appointments?world_id=eq.${encodeURIComponent(worldId)}&status=eq.active&select=manager_id,club_id&order=club_id.asc`);
  const ids = [...new Set(appointments.map((row) => row.manager_id).filter(Boolean))];
  if (!ids.length) return [];
  const idFilter = ids.map((id) => String(id).replaceAll(',', '')).join(',');
  const [profiles, clubNames] = await Promise.all([
    serviceSupabase(`/rest/v1/manager_profiles?id=in.(${idFilter})&select=id,display_name`),
    clubNamesForWorld(userId, worldId)
  ]);
  const names = new Map(profiles.map((profile) => [String(profile.id), profile.display_name]));
  return appointments
    .filter((row) => String(row.manager_id) !== String(selfId))
    .map((row) => ({
      manager_id: row.manager_id,
      manager_name: names.get(String(row.manager_id)) || 'Manager',
      club_id: row.club_id,
      club_name: clubNames.get(String(row.club_id)) || row.club_id
    }))
    .sort((a, b) => String(a.manager_name).localeCompare(String(b.manager_name)));
}

async function contactFor(managerId, isSelf) {
  const rows = await serviceSupabase(`/rest/v1/manager_public_contacts?manager_id=eq.${encodeURIComponent(managerId)}&select=whatsapp,contact_email,discord,publish_whatsapp,publish_email,publish_discord&limit=1`);
  const row = rows[0] || {};
  if (isSelf) return {
    whatsapp: row.whatsapp || '', contact_email: row.contact_email || '', discord: row.discord || '',
    publish_whatsapp: Boolean(row.publish_whatsapp), publish_email: Boolean(row.publish_email), publish_discord: Boolean(row.publish_discord)
  };
  return {
    whatsapp: row.publish_whatsapp ? row.whatsapp || '' : '',
    contact_email: row.publish_email ? row.contact_email || '' : '',
    discord: row.publish_discord ? row.discord || '' : ''
  };
}

async function saveContact(managerId, body) {
  const row = {
    manager_id: managerId,
    whatsapp: cleanText(body.whatsapp),
    contact_email: cleanText(body.contact_email),
    discord: cleanText(body.discord),
    publish_whatsapp: Boolean(body.publish_whatsapp),
    publish_email: Boolean(body.publish_email),
    publish_discord: Boolean(body.publish_discord),
    updated_at: new Date().toISOString()
  };
  await serviceSupabase('/rest/v1/manager_public_contacts?on_conflict=manager_id', {
    method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row)
  });
  return contactFor(managerId, true);
}

async function bugHunterFor(userId, worldId, target) {
  return serviceSupabase('/rest/v1/rpc/get_manager_bug_hunter_for_user', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_world_id: worldId, p_target_manager_id: target })
  });
}

export default async (request) => {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await identity(token);
    const context = await activeContext(user.id);

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (body.action !== 'save-contact') return json({ error: 'Unknown action' }, 400);
      return json({ contact: await saveContact(context.managerId, body) });
    }

    const url = new URL(request.url);
    const target = String(url.searchParams.get('manager_id') || '').trim() || null;
    const [result, hunter] = await Promise.all([
      serviceSupabase('/rest/v1/rpc/get_manager_participation_for_user', {
        method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_world_id: context.worldId, p_target_manager_id: target })
      }),
      bugHunterFor(user.id, context.worldId, target)
    ]);

    const targetId = target || context.managerId;
    const isSelf = String(targetId) === String(context.managerId) || result?.is_self === true;
    result.pins = [...(Array.isArray(result.pins) ? result.pins : []), ...(Array.isArray(hunter?.pins) ? hunter.pins : [])];
    if (isSelf && hunter?.private_detail) result.bug_hunter = hunter.private_detail;
    result.contact = await contactFor(targetId, isSelf);
    if (isSelf) result.directory = await managerDirectory(context.worldId, context.managerId, user.id);
    return json(result);
  } catch (error) {
    const message = String(error?.message || 'Could not load manager participation');
    const status = /Session|Authentication/.test(message) ? 401
      : /appointment|profile/i.test(message) ? 409
      : /not active in this world/i.test(message) ? 404
      : 503;
    return json({ error: message }, status);
  }
};
