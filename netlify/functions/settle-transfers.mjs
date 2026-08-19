import { settleDueTransfers } from './_lib/transfer-settlement.mjs';
import { resolveScheduledFreeAgentOffers } from './_lib/free-agent-offer-scheduler.mjs';

export const config = { schedule: '*/5 * * * *' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default async () => {
  try {
    const [transfers, freeAgents] = await Promise.all([
      settleDueTransfers({ limit: 20 }),
      resolveScheduledFreeAgentOffers({ limit: 20 })
    ]);
    return json({ ok: true, transfers, free_agents: freeAgents });
  } catch (error) {
    return json({ ok: false, error: error.message }, 503);
  }
};
