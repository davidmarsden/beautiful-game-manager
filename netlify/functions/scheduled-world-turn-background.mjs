import scheduledWorldTurnWorker from './scheduled-world-turn-worker.mjs';
import { createCheckpointReconciliationFetch } from '../../src/world/checkpointWriteFetchReconciliation.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const INTERNAL_SECRET = process.env.TBG_INTERNAL_SCHEDULER_SECRET || '';

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

export default async (request) => {
  if (request.method !== 'POST') return;
  if (!INTERNAL_SECRET || request.headers.get('x-tbg-scheduler-secret') !== INTERNAL_SECRET) {
    console.error('Rejected unauthorized scheduled-world-turn background invocation');
    return;
  }

  const response = await executeScheduledWorldTurnWithReconciliation();
  const body = await response.text().catch(() => '');
  console.log('Scheduled world turn background result', response.status, body);
};
