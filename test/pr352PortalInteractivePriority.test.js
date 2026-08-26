import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../public/portal-auth-bridge.js', import.meta.url), 'utf8');

test('portal load shedding keeps the existing secondary concurrency cap', () => {
  assert.match(bridge, /const MAX_SECONDARY_CONCURRENCY = 2/);
});

test('interactive requests are selected ahead of queued normal and background work', () => {
  assert.match(bridge, /priorityRank[\s\S]*interactive:\s*0[\s\S]*normal:\s*1[\s\S]*background:\s*2/);
  assert.match(bridge, /function|const nextQueuedTask/);
  assert.match(bridge, /rankDelta < 0/);
  assert.match(bridge, /queue\.splice\(bestIndex, 1\)\[0\]/);
});

test('World Feed first paint is interactive while sync and activity yield as background work', () => {
  assert.match(bridge, /details\.method === 'GET'\) return 'interactive'/);
  assert.match(bridge, /\['sync', 'activity'\]\.includes\(worldFeedAction\(details\)\)\) return 'background'/);
});

test('same-priority requests remain FIFO', () => {
  assert.match(bridge, /candidate\.sequence < best\.sequence/);
  assert.match(bridge, /sequence:\s*requestSequence\+\+/);
});

test('callers can explicitly mark future portal work interactive or background', () => {
  assert.match(bridge, /headers\.get\('x-tbg-priority'\)/);
  assert.match(bridge, /\['interactive', 'normal', 'background'\]\.includes\(details\.priority\)/);
});
