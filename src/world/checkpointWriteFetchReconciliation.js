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
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
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

/**
 * Wrap fetch so an ambiguous PostgREST checkpoint response is reconciled
 * against the compact authoritative row before the scheduler sees an error.
 *
 * The settlement window is measured from the start of the original RPC. It is
 * intentionally longer than the database write timeout, so a previous-checksum
 * observation remains pending until the original transaction can no longer
 * become authoritative.
 */
export function createCheckpointReconciliationFetch({
  fetchImpl,
  supabaseUrl,
  serviceRoleKey,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  settlementWindowMs = DEFAULT_SETTLEMENT_WINDOW_MS
}) {
  if (typeof fetchImpl !== 'function') throw new Error('Checkpoint reconciliation requires fetch');

  return async (url, options = {}) => {
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

    return jsonResponse({
      accepted: false,
      world_id: worldId,
      reason: 'checkpoint_write_not_committed',
      message: 'Canonical checkpoint still had not committed after the bounded settlement window',
      canonical_checksum: lastObservation?.canonical_checksum || null
    }, 504);
  };
}
