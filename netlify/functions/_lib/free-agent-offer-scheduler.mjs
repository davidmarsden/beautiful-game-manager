import { resolveDueFreeAgentOffers } from './free-agent-offers.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;

async function dueWorldIds(limit = 20) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_due_free_agent_world_ids`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ p_limit: Math.max(1, Math.min(100, Number(limit) || 20)) })
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || rows.error || `Supabase returned ${response.status}`);
  return (Array.isArray(rows) ? rows : []).map((row) => row.world_id).filter(Boolean);
}

export async function resolveScheduledFreeAgentOffers({ limit = 20 } = {}) {
  const worlds = await dueWorldIds(limit);
  const outcomes = [];
  for (const worldId of worlds) {
    outcomes.push(...await resolveDueFreeAgentOffers({ worldId, limit }));
  }
  return { worlds_checked: worlds.length, outcomes };
}
