import {
  executePortalWorldCommand,
  loadPortalWorld,
  portalWorldSummary,
  savePortalWorld
} from '../../src/world/portalWorldControl.js';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function supabase(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase ${path} returned ${response.status}`);
  return body;
}

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

async function readSave(token, managerId, worldId) {
  const rows = await supabase(`/rest/v1/persistent_world_saves?manager_id=eq.${encodeURIComponent(managerId)}&world_id=eq.${encodeURIComponent(worldId)}&select=*&limit=1`, token);
  return rows[0] || null;
}

async function writeSave(token, identityRow, result) {
  const summary = result.summary || portalWorldSummary(result.world);
  const envelope = JSON.parse(result.saved_world);
  const payload = {
    world_id: identityRow.appointment.world_id,
    manager_id: identityRow.manager.id,
    club_id: identityRow.appointment.club_id,
    save_version: envelope.version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    season_id: summary.season_id,
    season_number: summary.season_number,
    phase: summary.phase,
    matchday: summary.current_matchday,
    updated_at: new Date().toISOString()
  };
  const rows = await supabase('/rest/v1/persistent_world_saves?on_conflict=world_id,manager_id', token, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { prefer: 'resolution=merge-duplicates,return=representation' }
  });
  return rows[0] || payload;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const stored = await readSave(token, current.manager.id, current.appointment.world_id);

    if (request.method === 'GET') {
      if (!stored) return json({ configured: true, has_save: false, world_id: current.appointment.world_id, club_id: current.appointment.club_id });
      const loaded = loadPortalWorld(JSON.stringify(stored.save_envelope));
      if (loaded.world.human_club_id !== current.appointment.club_id) return json({ error: 'Stored world does not match the active club appointment' }, 409);
      return json({ configured: true, has_save: true, summary: loaded.summary, save: { updated_at: stored.updated_at, checksum: stored.save_checksum } });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => ({}));
    let result;
    if (!stored) {
      if (body.type !== 'import_save' || !body.saved_world) return json({ error: 'No persistent save exists. Import a valid save first.' }, 409);
      const imported = loadPersistentWorld(typeof body.saved_world === 'string' ? body.saved_world : JSON.stringify(body.saved_world));
      if (imported.human_club_id !== current.appointment.club_id) return json({ error: 'Imported save does not match the active club appointment' }, 409);
      result = savePortalWorld(imported);
    } else {
      const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
      if (world.human_club_id !== current.appointment.club_id) return json({ error: 'Stored world does not match the active club appointment' }, 409);
      if (body.type === 'export_save') {
        return json({ accepted: true, command: 'export_save', summary: portalWorldSummary(world), saved_world: JSON.stringify(stored.save_envelope) });
      }
      result = executePortalWorldCommand(world, body);
    }
    const saved = await writeSave(token, current, result);
    return json({ accepted: result.accepted, command: result.command, result: result.result, summary: result.summary, save: { updated_at: saved.updated_at, checksum: saved.save_checksum } });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /appointment|match|checkpoint|window|registration|contract|transfer|player/i.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
