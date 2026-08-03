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

test('does not claim non-commit until the bounded settlement window expires', async () => {
  let reads = 0;
  const wrapped = createCheckpointReconciliationFetch({
    fetchImpl: async (url) => {
      if (String(url).includes('/rpc/')) return new Response('{}', { status: 504 });
      reads += 1;
      return canonicalResponse('checksum-before', 'locking');
    },
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-key',
    pollIntervalMs: 2,
    settlementWindowMs: 12
  });

  const response = await wrapped(rpcUrl, rpcOptions);
  const body = await response.json();
  assert.equal(response.status, 504);
  assert.equal(body.reason, 'checkpoint_write_not_committed');
  assert.ok(reads > 1);
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
