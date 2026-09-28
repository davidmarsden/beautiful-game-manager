import { runScheduledJob } from './_lib/scheduled-job-guard.mjs';
import { settleDueTransfers } from './_lib/transfer-settlement.mjs';
import { settleDueExternalTransfers } from './_lib/external-transfer-settlement.mjs';
import { generateScheduledExternalOffers } from './_lib/external-transfer-offers.mjs';
import { resolveScheduledFreeAgentOffers } from './_lib/free-agent-offer-scheduler.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

async function runScheduledWork() {
  try {
    // External sales have their own settlement path because external TPF clubs are
    // real market counterparties, not simulated squad-cycle clubs. Settle those first,
    // then process ordinary managed-club deals and generate fresh external offers.
    const externalTransfers = await settleDueExternalTransfers({ limit: 20 });
    const [transfers, freeAgents, externalOffers] = await Promise.all([
      settleDueTransfers({ limit: 20 }),
      resolveScheduledFreeAgentOffers({ limit: 20 }),
      generateScheduledExternalOffers({ limit: 20 })
    ]);
    return json({
      ok: true,
      transfers,
      external_transfers: externalTransfers,
      external_offers: externalOffers,
      free_agents: freeAgents
    });
  } catch (error) {
    return json({ ok: false, error: error.message }, 503);
  }
};


export default () => runScheduledJob('settle-transfers', runScheduledWork);
