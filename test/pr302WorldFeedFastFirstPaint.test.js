import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');

test('World Feed GET does not block on system projection reconciliation', () => {
  const getBlockStart = endpoint.indexOf("if (request.method === 'GET')");
  const postBlockStart = endpoint.indexOf("if (request.method !== 'POST')", getBlockStart);
  const getBlock = endpoint.slice(getBlockStart, postBlockStart);
  assert.ok(getBlock.includes('currentFeedWithTarget(user.id, appointment.world_id, requestedItemId)'));
  assert.ok(endpoint.includes('const feed = await currentFeed(userId, worldId);'));
  assert.equal(getBlock.includes('sync_world_feed_system_items'), false);
  assert.ok(endpoint.includes("if (action === 'sync')"));
  assert.ok(endpoint.includes("rpc('sync_world_feed_system_items'"));
});

test('World Feed keeps rendered content visible while stale data refreshes silently', () => {
  assert.ok(feed.includes("const alreadyRendered = Boolean(root.querySelector('.world-feed-shell'))"));
  assert.ok(feed.includes("if (!alreadyRendered) root.innerHTML = '<div class=\"empty-state\">Loading World Feed…</div>'"));
  assert.ok(feed.includes("if (current && !current.querySelector('.world-feed-shell'))"));
});

test('system projection sync is throttled and follows up only when system-feed rows actually changed', () => {
  assert.ok(feed.includes('const FEED_SYNC_TTL = 60_000'));
  assert.ok(feed.includes("sendFeedAction({ action: 'sync' })"));
  assert.ok(feed.includes('if (!result?.changed) return'));
  assert.ok(endpoint.includes('async function systemFeedSignature(worldId)'));
  assert.ok(endpoint.includes('const before = await systemFeedSignature(appointment.world_id)'));
  assert.ok(endpoint.includes('const after = await systemFeedSignature(appointment.world_id)'));
  assert.ok(endpoint.includes('return json({ changed: before !== after })'));
  assert.ok(feed.includes('void refreshSystemProjection()'));
});

test('background and stale refreshes never replace a focused or non-empty feed draft', () => {
  assert.ok(feed.includes('function hasActiveFeedDraft()'));
  assert.ok(feed.includes("field === document.activeElement || field.value.trim() !== ''"));
  assert.ok(feed.includes('if (hasActiveFeedDraft()) {'));
  assert.ok(feed.includes('if (alreadyRendered && hasActiveFeedDraft()) {'));
  assert.ok(feed.includes('feedLoadedAt = 0'));
});
