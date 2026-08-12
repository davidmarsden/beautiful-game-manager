import { executeScheduledWorldTurnWithReconciliation } from '../internal/execute-scheduled-world-turn.mjs';
import { verifyInternalSchedulerRequest } from '../../src/world/internalSchedulerAuth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STALE_TURN_LEASE = '00:20:00';

const isJwt = (value) => String(value || '').split('.').length === 3;

function serviceHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    ...(isJwt(SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SERVICE_ROLE_KEY}` } : {}),
    accept: 'application/json',
    'content-type': 'application/json'
  };
}

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

export async function recoverAbandonedScheduledTurns(now = new Date().toISOString()) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return [];

  const lockingWorlds = await service('/rest/v1/canonical_world_saves?turn_status=eq.locking&select=world_id,save_checksum,updated_at');
  const recovered = [];

  for (const world of Array.isArray(lockingWorlds) ? lockingWorlds : []) {
    try {
      const result = await service('/rest/v1/rpc/recover_stale_canonical_turn_lock', {
        method: 'POST',
        body: JSON.stringify({
          p_world_id: world.world_id,
          p_expected_checksum: world.save_checksum,
          p_expected_updated_at: world.updated_at,
          p_requested_by: null,
          p_now: now,
          p_lease: STALE_TURN_LEASE
        })
      });
      const recovery = Array.isArray(result) ? result[0] : result;
      if (recovery?.recovered) recovered.push(recovery);
    } catch (error) {
      // One malformed or otherwise unrecoverable world must never starve later
      // stale locks. Leave this candidate untouched for diagnosis/retry and
      // continue attempting the rest of the sweep independently.
      console.error('Scheduled turn stale-lock recovery failed for world', {
        world_id: world.world_id,
        checksum: world.save_checksum,
        updated_at: world.updated_at,
        error: error?.message || String(error)
      });
    }
  }

  return recovered;
}

export default async (request) => {
  if (request.method !== 'POST') return;
  if (!verifyInternalSchedulerRequest(request, SERVICE_ROLE_KEY)) {
    console.error('Rejected unauthorized scheduled-world-turn background invocation');
    return;
  }

  try {
    const recovered = await recoverAbandonedScheduledTurns();
    for (const recovery of recovered) {
      console.warn('Recovered abandoned scheduled turn before scheduler sweep', {
        world_id: recovery.world_id,
        failed_run_id: recovery.failed_run_id || null,
        checksum: recovery.checksum || null,
        reason: recovery.reason || null,
        submissions_reopened: recovery.submissions_reopened ?? null
      });
    }
  } catch (error) {
    // A watchdog query-level failure must not prevent unrelated open worlds from
    // advancing. Per-world RPC failures are isolated inside the recovery loop.
    console.error('Scheduled turn stale-lock watchdog failed', error);
  }

  const response = await executeScheduledWorldTurnWithReconciliation();
  const body = await response.text().catch(() => '');
  console.log('Scheduled world turn background result', response.status, body);
};
