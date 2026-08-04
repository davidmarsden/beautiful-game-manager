import { executeScheduledWorldTurnWithReconciliation } from '../internal/execute-scheduled-world-turn.mjs';
import { createInternalSchedulerHeaders } from '../../src/world/internalSchedulerAuth.js';

export * from '../internal/scheduled-world-turn-worker.mjs';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

export default async (request) => {
  // Direct module calls come from the authenticated administrator recovery path,
  // which already runs inside a 15-minute background function.
  if (!request) return executeScheduledWorldTurnWithReconciliation();

  if (!SERVICE_ROLE_KEY) return json({ error: 'Scheduled world processing is not configured' }, 503);

  const target = new URL('/.netlify/functions/scheduled-world-turn-background', request.url);
  const response = await fetch(target, {
    method: 'POST',
    headers: createInternalSchedulerHeaders(SERVICE_ROLE_KEY)
  });

  if (!response.ok) {
    return json({ error: `Background turn dispatch failed with ${response.status}` }, 503);
  }

  return json({ accepted: true, dispatched: true });
};

export const config = { schedule: '*/15 * * * *' };
