import { resolveDueFreeAgentOffers } from './free-agent-offers.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;

async function dueWorldIds(limit = 20) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/free_agent_offers?status=eq.pending&decision_at=lte.${encodeURIComponent(new Date().toISOString())}&select=world_id&order=decision_at.asc&limit=${Math.max(1, Math.min(100, Number(limit) || 20))}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      accept: 'application/json'
    }
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || rows.error || `Supabase returned ${response.status}`);
  return [...new Set((Array.isArray(rows) ? rows : []).map((row) => row.world_id).filter(Boolean))];
}

export async function resolveScheduledFreeAgentOffers({ limit = 20 } = {}) {
  const worlds = await dueWorldIds(limit);
  const outcomes = [];
  for (const worldId of worlds) {
    outcomes.push(...await resolveDueFreeAgentOffers({ worldId, limit }));
  }
  return { worlds_checked: worlds.length, outcomes };
}
