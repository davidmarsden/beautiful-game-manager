import {
  CHECKPOINT_WRITE_OUTCOME,
  reconcileCheckpointWrite
} from './checkpointWriteReconciliation.js';

const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_SETTLEMENT_WINDOW_MS = 105000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isCheckpointReplacement(url, options = {}) {
  return String(url).includes('/rest/v1/rpc/replace_canonical_world_checkpoint')
    && String(options.method || 'GET').toUpperCase() === 'POST';
}

function isRetriableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function requestPayload(options = {}) {
  if (typeof options.body !== 'string') return null;
  try {
    return JSON.parse(options.body);
  } catch {
    return null;
  }
}

function suppressResponse() {
  return new Response(null, { status: 204 });
}

async function readCanonicalCheckpoint({ fetchImpl, supabaseUrl, serviceRoleKey, worldId }) {
  const response = await fetchImpl(
    `${supabaseUrl}/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=world_id,save_checksum,turn_status,updated_at&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: 'application/json'
      }
    }
  );
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function isUnsafeSubmissionUnlock(url, options, unresolved) {
  if (!unresolved || String(options.method || '').toUpperCase() !== 'PATCH') return false;
  const body = requestPayload(options);
  return String(url).includes('/rest/v1/manager_turn_submissions?')
    && String(url).includes(`world_id=eq.${encodeURIComponent(unresolved.worldId)}`)
    && String(url).includes('status=eq.locked')
    && body?.status === 'submitted';
}

function isUnsafeCanonicalFailure(url, options, unresolved) {
  if (!unresolved || String(options.method || '').toUpperCase() !== 'PATCH') return false;
  const body = requestPayload(options);
  return String(url).includes('/rest/v1/canonical_world_saves?')
    && String(url).includes(`world_id=eq.${encodeURIComponent(unresolved.worldId)}`)
    && String(url).includes(`save_checksum=eq.${encodeURIComponent(unresolved.previousChecksum)}`)
    && String(url).includes('turn_status=eq.locking')
    && body?.turn_status === 'failed';
}

function isFailedRunUpdate(url, options, unresolved) {
  if (!unresolved || String(options.method || '').toUpperCase() !== 'PATCH') return false;
  const body = requestPayload(options);
  return String(url).includes('/rest/v1/world_turn_runs?') && body?.status === 'failed';
}

/**
 * Wrap fetch so an ambiguous PostgREST checkpoint response is reconciled
 * against the compact authoritative row before the scheduler sees an error.
 *
 * The settlement window is measured from the start of the original RPC. It is
 * intentionally longer than the database write timeout, so a previous-checksum
 * observation remains pending until the original transaction can no longer
 * become authoritative.
 *
 * If certainty is still impossible when the window expires, the wrapper also
 * protects the old scheduler catch path: it suppresses submission reopening and
 * canonical failure writes, and records the turn run as reconciliation_required.
 */
export function createCheckpointReconciliationFetch({
  fetchImpl,
  supabaseUrl,
  serviceRoleKey,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  settlementWindowMs = DEFAULT_SETTLEMENT_WINDOW_MS
}) {
  if (typeof fetchImpl !== 'function') throw new Error('Checkpoint reconciliation requires fetch');

  let unresolvedWrite = null;

  return async (url, options = {}) => {
    if (isUnsafeSubmissionUnlock(url, options, unresolvedWrite)) return suppressResponse();
    if (isUnsafeCanonicalFailure(url, options, unresolvedWrite)) return suppressResponse();

    if (isFailedRunUpdate(url, options, unresolvedWrite)) {
      const body = requestPayload(options) || {};
      return fetchImpl(url, {
        ...options,
        body: JSON.stringify({
          ...body,
          status: 'reconciliation_required',
          error_message: unresolvedWrite.reason
        })
      });
    }

    if (!isCheckpointReplacement(url, options)) return fetchImpl(url, options);

    const startedAt = Date.now();
    const response = await fetchImpl(url, options);
    if (response.ok || !isRetriableStatus(response.status)) return response;

    const payload = requestPayload(options);
    const worldId = String(payload?.p_world_id || '').trim();
    const previousChecksum = String(payload?.p_previous_checksum || '').trim();
    const expectedReplacementChecksum = String(payload?.p_replacement?.save_checksum || '').trim();
    if (!worldId || !previousChecksum || !expectedReplacementChecksum) return response;

    const deadline = startedAt + settlementWindowMs;
    let lastObservation = null;

    while (Date.now() < deadline) {
      const canonicalCheckpoint = await readCanonicalCheckpoint({
        fetchImpl,
        supabaseUrl,
        serviceRoleKey,
        worldId
      }).catch(() => null);

      lastObservation = reconcileCheckpointWrite({
        worldId,
        previousChecksum,
        expectedReplacementChecksum,
        canonicalCheckpoint
      });

      if (lastObservation.outcome === CHECKPOINT_WRITE_OUTCOME.COMMITTED) {
        return jsonResponse({
          accepted: true,
          world_id: worldId,
          previous_checksum: previousChecksum,
          replacement_checksum: expectedReplacementChecksum,
          turn_status: lastObservation.turn_status || null,
          reconciled_after_ambiguous_response: true
        }, 200);
      }

      if (lastObservation.outcome === CHECKPOINT_WRITE_OUTCOME.CONFLICT) {
        return jsonResponse({
          accepted: false,
          world_id: worldId,
          reason: 'checkpoint_conflict',
          message: lastObservation.reason,
          canonical_checksum: lastObservation.canonical_checksum
        }, 409);
      }

      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
    }

    unresolvedWrite = {
      worldId,
      previousChecksum,
      expectedReplacementChecksum,
      reason: 'Checkpoint outcome remained ambiguous after bounded reconciliation; canonical lock and submissions were preserved for explicit recovery'
    };

    return jsonResponse({
      accepted: false,
      world_id: worldId,
      reason: 'reconciliation_required',
      message: unresolvedWrite.reason,
      canonical_checksum: lastObservation?.canonical_checksum || null
    }, 504);
  };
}
