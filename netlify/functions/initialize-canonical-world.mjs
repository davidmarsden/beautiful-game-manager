import { buildCanonicalWorldFromPublication } from '../../src/world/canonicalWorldInitialization.js';
import { buildWorldBackupRecord } from '../../src/world/worldOperations.js';
import { nextScheduledTurn } from './scheduled-world-turn.mjs';

const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';
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

async function requestSupabase(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: token,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function adminIdentity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await requestSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,display_name,is_admin&limit=1`, token);
  const manager = profiles[0];
  if (!manager?.is_admin) throw new Error('Administrator access required');
  const appointments = await requestSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  if (!appointments[0]) throw new Error('Administrator has no active world appointment');
  return { user, manager, appointment: appointments[0] };
}

async function fetchPublicationWorld() {
  const response = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`World publication returned ${response.status}`);
  return response.json();
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Canonical-world initialization is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await adminIdentity(token);
    const worldId = current.appointment.world_id;
    const existing = await requestSupabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=world_id&limit=1`, SUPABASE_SERVICE_ROLE_KEY);
    if (existing[0]) return json({ error: `Canonical world ${worldId} has already been initialized` }, 409);

    const publication = await fetchPublicationWorld();
    const body = await request.json().catch(() => ({}));
    const initialized = buildCanonicalWorldFromPublication(publication, {
      worldId,
      humanClubId: current.appointment.club_id,
      seasonStart: body.season_start || process.env.TBG_SEASON_START || '2026-08-01T00:00:00.000Z',
      seasonEnd: body.season_end || process.env.TBG_SEASON_END || '2027-06-30T23:59:59.000Z',
      registrationLimit: Number(process.env.TBG_REGISTRATION_LIMIT || 25),
      movementCount: Number(process.env.TBG_PROMOTION_PLACES || 4)
    });
    const now = new Date().toISOString();
    const nextTurnAt = nextScheduledTurn(new Date(now));
    const stored = {
      world_id: worldId,
      save_version: initialized.envelope.save_version,
      save_checksum: initialized.envelope.checksum,
      save_envelope: initialized.envelope,
      season_id: initialized.world.squad_cycle.season_id,
      season_number: initialized.world.season_number,
      phase: initialized.world.phase,
      matchday: null,
      next_turn_at: nextTurnAt,
      turn_status: 'open',
      created_at: now,
      updated_at: now
    };
    const inserted = await requestSupabase('/rest/v1/canonical_world_saves', SUPABASE_SERVICE_ROLE_KEY, {
      method: 'POST', body: JSON.stringify(stored)
    });
    const backup = buildWorldBackupRecord(stored, {
      backupId: `${worldId}:initial`,
      trigger: 'manual',
      reason: 'canonical_world_initialization',
      createdAt: now,
      createdBy: current.manager.id
    });
    await requestSupabase('/rest/v1/persistent_world_backups', SUPABASE_SERVICE_ROLE_KEY, {
      method: 'POST', body: JSON.stringify({ ...backup, manager_id: null, club_id: null })
    });
    await requestSupabase('/rest/v1/world_operation_events', SUPABASE_SERVICE_ROLE_KEY, {
      method: 'POST',
      body: JSON.stringify({
        operation_id: `initialize:${worldId}:${Date.parse(now)}`,
        operation_type: 'initialize',
        world_id: worldId,
        manager_id: null,
        club_id: null,
        previous_checksum: null,
        replacement_checksum: initialized.envelope.checksum,
        status: 'accepted',
        details: { action: 'initialize_canonical_world', summary: initialized.summary },
        requested_by: current.manager.id,
        created_at: now
      })
    });
    return json({
      accepted: true,
      world: inserted[0] || stored,
      summary: initialized.summary,
      next_turn_at: nextTurnAt,
      backup_id: backup.backup_id
    }, 201);
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : /already been initialized/.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
