import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInternalSchedulerHeaders,
  verifyInternalSchedulerRequest
} from '../src/world/internalSchedulerAuth.js';

const secret = 'server-only-secret';
const now = 1_800_000_000_000;

function requestWith(headers) {
  return new Request('https://example.netlify.app/.netlify/functions/scheduled-world-turn-background', {
    method: 'POST',
    headers
  });
}

test('accepts a fresh correctly signed internal scheduler request', () => {
  const headers = createInternalSchedulerHeaders(secret, now);
  assert.equal(verifyInternalSchedulerRequest(requestWith(headers), secret, now + 1000), true);
});

test('rejects altered signatures', () => {
  const headers = createInternalSchedulerHeaders(secret, now);
  headers['x-tbg-scheduler-signature'] = `${headers['x-tbg-scheduler-signature'].slice(0, -1)}0`;
  assert.equal(verifyInternalSchedulerRequest(requestWith(headers), secret, now), false);
});

test('rejects stale signed requests', () => {
  const headers = createInternalSchedulerHeaders(secret, now);
  assert.equal(verifyInternalSchedulerRequest(requestWith(headers), secret, now + (6 * 60 * 1000)), false);
});

test('rejects requests when the server secret is unavailable', () => {
  const headers = createInternalSchedulerHeaders(secret, now);
  assert.equal(verifyInternalSchedulerRequest(requestWith(headers), '', now), false);
});
