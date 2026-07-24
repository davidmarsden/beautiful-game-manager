import { planCanonicalRegistrationRepair } from '../../src/world/viableCanonicalRegistration.js';
import { importCanonicalFreeAgentReservoir } from '../../src/world/canonicalFreeAgentReservoir.js';
import { loadPersistentWorld, savePersistentWorld } from '../../src/world/persistentSeasonLoop.js';

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

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

async function fetchPublicationWorld() {
  const response = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`World publication returned ${response.status}`);
  return response.json();
}

function reservoirFingerprint(ids) {
  let hash = 2166136261;
  for (const character of [...ids].sort().join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function adminIdentity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,is_admin&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  if (!profileResponse.ok) throw new Error('Could not resolve administrator profile');
  const manager = (await profileResponse.json())[0];
  if (!manager?.is_admin) throw new Error('Administrator access required');
  const appointmentResponse = await fetch(`${SUPABASE_URL}/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  if (!appointmentResponse.ok) throw new Error('Could not resolve administrator appointment');
  const appointment = (await appointmentResponse.json())[0];
  if (!appointment) throw new Error('Administrator has no active world appointment');
  return { manager, appointment };
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Canonical registration repair is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await adminIdentity(token);
    const payload = await request.json().catch(() => ({}));
    const action = payload.action === 'apply' ? 'apply' : 'preview';
    const worldId = current.appointment.world_id;
    const rows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*`);
    const before = rows[0];
    if (!before) return json({ error: `Canonical world ${worldId} does not exist` }, 404);
    if (before.phase !== 'preseason') return json({ error: `Registration repair is only available in preseason; world phase is ${before.phase}` }, 409);
    if (!['open', 'failed'].includes(before.turn_status)) return json({ error: `Canonical world is ${before.turn_status}; wait for the active operation to finish` }, 409);

    const publication = await fetchPublicationWorld();
    const world = loadPersistentWorld(JSON.stringify(before.save_envelope));
    const reservoir = importCanonicalFreeAgentReservoir(world, publication);
    const fingerprint = reservoirFingerprint(reservoir.imported_player_ids);
    const planned = planCanonicalRegistrationRepair(world, {
      at: world.squad_cycle.calendar?.transfer_windows?.[0]?.opens_at || world.clock
    });
    const preview = {
      ...planned.preview,
      world_id: worldId,
      source_checksum: before.save_checksum,
      turn_status: before.turn_status,
      phase: before.phase,
      reservoir_imported: reservoir.imported_count,
      reservoir_available_after_repair: Object.values(planned.world.squad_cycle.players).filter((player) => !player.club_id).length,
      reservoir_fingerprint: fingerprint,
      publication_source: WORLD_URL
    };
    if (action === 'preview') return json({ action: 'preview', preview });
    if (payload.expected_checksum !== before.save_checksum) return json({ error: 'Canonical checkpoint changed after preview; run preview again' }, 409);
    if (payload.expected_reservoir_fingerprint !== fingerprint) return json({ error: 'Published free-agent reservoir changed after preview; run preview again' }, 409);
    if (!planned.preview.accepted) return json({ error: 'Registration repair cannot be applied while clubs remain impossible to repair', preview }, 409);

    const operationId = `registration-repair:${worldId}:${before.save_checksum}:${fingerprint}`;
    const saved = savePersistentWorld(planned.world);
    const envelope = JSON.parse(saved);
    const now = new Date().toISOString();
    const replacement = {
      save_version: envelope.save_version,
      save_checksum: envelope.checksum,
      save_envelope: envelope,
      season_id: planned.world.squad_cycle.season_id,
      season_number: planned.world.season_number,
      phase: planned.world.phase,
      matchday: planned.world.matchday_cycle?.current_matchday || before.matchday,
      next_turn_at: before.next_turn_at,
      turn_status: before.turn_status,
      updated_at: now
    };
    const operation = {
      operation_id: operationId,
      operation_type: 'registration_repair',
      world_id: worldId,
      manager_id: null,
      club_id: null,
      previous_checksum: before.save_checksum,
      replacement_checksum: envelope.checksum,
      status: 'accepted',
      details: {
        action: 'repair_canonical_registrations_with_free_agent_reservoir',
        before: { checksum: before.save_checksum, phase: before.phase, turn_status: before.turn_status, matchday: before.matchday },
        after: { checksum: envelope.checksum, phase: planned.world.phase, turn_status: before.turn_status, matchday: replacement.matchday },
        reservoir: { imported_count: reservoir.imported_count, fingerprint, publication_source: WORLD_URL },
        preview
      },
      requested_by: current.manager.id,
      created_at: now
    };

    const atomic = await service('/rest/v1/rpc/apply_canonical_registration_repair', {
      method: 'POST',
      body: JSON.stringify({
        p_world_id: worldId,
        p_expected_checksum: before.save_checksum,
        p_expected_turn_status: before.turn_status,
        p_replacement: replacement,
        p_operation: operation
      })
    });
    if (!atomic?.accepted) {
      const message = atomic?.reason === 'duplicate_operation'
        ? 'This canonical registration repair has already been recorded'
        : 'Canonical checkpoint changed before repair could be applied';
      return json({ error: message }, 409);
    }

    return json({
      action: 'applied',
      accepted: true,
      operation_id: operationId,
      world_id: worldId,
      previous_checksum: before.save_checksum,
      replacement_checksum: envelope.checksum,
      preview
    });
  } catch (error) {
    const status = /Session|Authentication/.test(error.message) ? 401 : /Administrator/.test(error.message) ? 403 : /changed|already|only available|is locking|is processing|remain impossible/.test(error.message) ? 409 : 503;
    return json({ error: error.message }, status);
  }
};
