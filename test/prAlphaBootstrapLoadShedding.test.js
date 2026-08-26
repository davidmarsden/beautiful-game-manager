import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const bridge = read('public/portal-auth-bridge.js');

test('alpha bootstrap bridge gates authenticated secondary API traffic behind bootstrap', () => {
  assert.match(bridge, /MAX_SECONDARY_CONCURRENCY\s*=\s*2/);
  assert.match(bridge, /bootstrapState\s*=\s*'waiting'/);
  assert.match(bridge, /details\.url\.pathname\s*===\s*'\/api\/bootstrap'/);
  assert.match(bridge, /return queueSecondaryRequest\(args, details\)/);
  assert.match(bridge, /bootstrapState !== 'ready'/);
});

test('alpha bootstrap bridge single-flights concurrent bootstrap requests', () => {
  assert.match(bridge, /let bootstrapInFlight = null/);
  assert.match(bridge, /if \(!bootstrapInFlight\)/);
  assert.match(bridge, /bootstrapInFlight = upstreamFetch/);
  assert.match(bridge, /return response\.clone\(\)/);
});

test('alpha bootstrap bridge fails closed after bootstrap outage instead of releasing a request herd', () => {
  assert.match(bridge, /bootstrapState = response\.ok \? 'ready' : 'failed'/);
  assert.match(bridge, /failQueuedRequests\(response\.status \|\| 503\)/);
  assert.match(bridge, /code: 'portal_bootstrap_unavailable'/);
  assert.match(bridge, /if \(bootstrapState === 'failed'\) return unavailableResponse\(\)/);
});

test('portal authorization capture remains available to club claiming and other bridges', () => {
  assert.match(bridge, /window\.tbgPortalAuthorization/);
  assert.match(bridge, /details\.authorization/);
});
