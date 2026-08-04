import { executeScheduledWorldTurnWithReconciliation } from '../internal/execute-scheduled-world-turn.mjs';
import { verifyInternalSchedulerRequest } from '../../src/world/internalSchedulerAuth.js';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async (request) => {
  if (request.method !== 'POST') return;
  if (!verifyInternalSchedulerRequest(request, SERVICE_ROLE_KEY)) {
    console.error('Rejected unauthorized scheduled-world-turn background invocation');
    return;
  }

  const response = await executeScheduledWorldTurnWithReconciliation();
  const body = await response.text().catch(() => '');
  console.log('Scheduled world turn background result', response.status, body);
};
