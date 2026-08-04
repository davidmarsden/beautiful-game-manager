import scheduledWorldTurnWorker from './scheduled-world-turn-worker.mjs';
import { createCheckpointReconciliationFetch } from '../../src/world/checkpointWriteFetchReconciliation.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function executeScheduledWorldTurnWithReconciliation() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Scheduled world processing is not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = createCheckpointReconciliationFetch({
    fetchImpl: originalFetch,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY
  });

  try {
    return await scheduledWorldTurnWorker();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
