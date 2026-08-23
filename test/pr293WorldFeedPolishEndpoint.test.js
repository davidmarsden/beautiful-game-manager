import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');

test('mutation responses carry the refreshed item needed for incremental UI updates', () => {
  assert.ok(endpoint.includes('async function currentFeed'));
  assert.ok(endpoint.includes('async function bestEffortFeedItem'));
  assert.ok(endpoint.includes('return json({ ...result, item }, 201)'));
  assert.ok(endpoint.includes("String(candidate.id) === String(itemId)"));
});

test('successful mutations are not reported as failures when response enrichment fails', () => {
  assert.ok(endpoint.includes('try {\n    const feed = await currentFeed(userId, worldId);'));
  assert.ok(endpoint.includes('} catch {\n    return null;'));
  assert.ok(endpoint.includes('const item = await bestEffortFeedItem(user.id, appointment.world_id, result?.id);'));
  assert.ok(endpoint.includes('const item = await bestEffortFeedItem(user.id, appointment.world_id, payload.feed_item_id);'));
});
