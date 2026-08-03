import test from 'node:test';
import assert from 'node:assert/strict';

import { createCheckpointReconciliationFetch } from '../src/world/checkpointWriteFetchReconciliation.js';

const rpcUrl = 'https://example.supabase.co/rest/v1/rpc/replace_canonical_world_checkpoint';
const rpcOptions = {
  method: 'POST',
  body: JSON.stringify({
    p_world_id: 'world-alpha',
    p_previous_checksum: 'checksum-before',
    p_replacement: { save_checksum: 'checksum-after' }
  })
};

function canonicalResponse(checksum, turnStatus = 'open') {
  return new Response(JSON.stringify([{
    world_id: 'world-alpha',
    save_checksum: checksum,
    turn_status: turnStatus
  }]), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('passes successful checkpoint responses through unchanged', async () => {
  const original = new Response(JSON.stringify({ accepted: true }), { status: 200 });
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async () => original,
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key',
    pollIntervalMs: 1,
    settlementWindowMs: 10
  });

  assert.equal(await wrapped(rpcUrl, rpcOptions), original);
});

test('turns an ambiguous gateway error into success only after the expected checksum is canonical', async () => {
  let reads = 0;
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async (url) => {
      if (String(url).includes('/rpc/')) return new Response('{}', { status: 504 });
      reads += 1;
      return canonicalResponse(reads === 1 ? 'checksum-before' : 'checksum-after');
    },
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key',
    pollIntervalMs: 1,
    settlementWindowMs: 50
  });

  const response = await wrapped(rpcUrl, rpcOptions);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.accepted, true);
  assert.equal(body.reconciled_after_ambiguous_response, true);
  assert.ok(reads >= 2);
});

test('returns a terminal conflict when a third checksum becomes authoritative', async () => {
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async (url) => String(url).includes('/rpc/')
      ? new Response('{}', { status: 502 })
      : canonicalResponse('checksum-third'),
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key',
    pollIntervalMs: 1,
    settlementWindowMs: 20
  });

  const response = await wrapped(rpcUrl, rpcOptions);
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.accepted, false);
  assert.equal(body.reason, 'checkpoint_conflict');
});

test('preserves the lock and marks the run reconciliation_required when certainty is unavailable', async () => {
  const writes = [];
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes('/rpc/')) return new Response('{}', { status: 504 });
      if (String(url).includes('/canonical_world_saves?') && String(options.method || 'GET') === 'GET') {
        return canonicalResponse('checksum-before', 'locking');
      }
      writes.push({ url: String(url), options });
      return new Response('', { status: 204 });
    },
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key',
    pollIntervalMs: 1,
    settlementWindowMs: 8
  });

  const response = await wrapped(rpcUrl, rpcOptions);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).reason, 'reconciliation_required');

  const submissionUnlock = await wrapped(
    'https://example.supabase.co/rest/v1/manager_turn_submissions?world_id=eq.world-alpha&status=eq.locked',
    { method: 'PATCH', body: JSON.stringify({ status: 'submitted', locked_at: null }) }
  );
  assert.equal(submissionUnlock.status, 204);

  const canonicalFailure = await wrapped(
    'https://example.supabase.co/rest/v1/canonical_world_saves?world_id=eq.world-alpha&save_checksum=eq.checksum-before&turn_status=eq.locking',
    { method: 'PATCH', body: JSON.stringify({ turn_status: 'failed' }) }
  );
  assert.equal(canonicalFailure.status, 204);

  await wrapped(
    'https://example.supabase.co/rest/v1/world_turn_runs?id=eq.run-1',
    { method: 'PATCH', body: JSON.stringify({ status: 'failed', error_message: 'Supabase returned 504' }) }
  );

  assert.equal(writes.length, 1);
  const runBody = JSON.parse(writes[0].options.body);
  assert.equal(runBody.status, 'reconciliation_required');
  assert.match(runBody.error_message, /canonical lock and submissions were preserved/);
});

test('does not intercept unrelated fetch traffic', async () => {
  const original = new Response('ok', { status: 503 });
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async () => original,
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key'
  });

  assert.equal(await wrapped('https://example.supabase.co/rest/v1/worlds'), original);
});
