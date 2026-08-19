import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { buildWorldReadModel } from '../../src/world/worldReadModel.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;

export const config = { schedule: '*/15 * * * *' };

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'World read-model refresh is not configured' }), { status: 503 });
  }
  try {
    const saves = await service('/rest/v1/canonical_world_saves?select=world_id,save_checksum,save_envelope&order=world_id.asc');
    const results = [];
    for (const stored of saves) {
      try {
        const world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
        const readModel = buildWorldReadModel(world);
        const result = await service('/rest/v1/rpc/refresh_world_read_model_if_current', {
          method: 'POST',
          body: JSON.stringify({
            p_world_id: stored.world_id,
            p_expected_checksum: stored.save_checksum,
            p_read_model: readModel
          })
        });
        results.push({ world_id: stored.world_id, accepted: Boolean(result?.accepted), reason: result?.reason || null });
      } catch (error) {
        results.push({ world_id: stored.world_id, accepted: false, reason: error.message });
      }
    }
    const ok = results.every((row) => row.accepted || row.reason === 'checkpoint_changed');
    return new Response(JSON.stringify({ ok, worlds: results }), {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }
};
