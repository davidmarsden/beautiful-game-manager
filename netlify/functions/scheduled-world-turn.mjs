import { executeScheduledWorldTurnWithReconciliation } from './scheduled-world-turn-background.mjs';

const INTERNAL_SECRET = process.env.TBG_INTERNAL_SCHEDULER_SECRET || '';

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

  if (!INTERNAL_SECRET) return json({ error: 'Internal scheduler secret is not configured' }, 503);

  const target = new URL('/.netlify/functions/scheduled-world-turn-background', request.url);
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'x-tbg-scheduler-secret': INTERNAL_SECRET }
  });

  if (!response.ok) {
    return json({ error: `Background turn dispatch failed with ${response.status}` }, 503);
  }

  return json({ accepted: true, dispatched: true }, 202);
};

export const config = { schedule: '*/15 * * * *' };
