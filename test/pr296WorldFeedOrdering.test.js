import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823g_world_feed_activity_order.sql', import.meta.url), 'utf8');
const legacyRepair = fs.readFileSync(new URL('../supabase/migrations/20260823h_world_feed_legacy_matchday_repair.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');

test('completed matchdays collapse division runtime suffixes into one global feed item', () => {
  assert.ok(migration.includes("':d[0-9]+$'"));
  assert.ok(migration.includes('_world_feed_matchday_merge'));
  assert.ok(migration.includes('set feed_item_id = merge_row.winner_id'));
  assert.ok(migration.includes("'matchday_completed:' || completed.season_id || ':' || completed.matchday::text"));
});

test('legacy seasonless matchday rows merge into the known season rather than season-unknown', () => {
  assert.ok(legacyRepair.includes('known_seasons'));
  assert.ok(legacyRepair.includes("= 'season-unknown'"));
  assert.ok(legacyRepair.includes('known.season_id'));
  assert.ok(legacyRepair.includes('set feed_item_id = repair.winner_id'));
});

test('World Feed sorts pinned items first and otherwise by latest comment activity', () => {
  assert.ok(migration.includes('greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at))'));
  assert.ok(migration.includes('order by is_pinned desc'));
  assert.ok(migration.includes("'activity_at'"));
  assert.ok(migration.includes("'pinned_at'"));
});

test('historical matchdays with tied backfill timestamps sort newest matchday first without inventing dates', () => {
  assert.ok(endpoint.includes('function compareFeedItems'));
  assert.ok(endpoint.includes("left?.item_type === 'matchday_completed'"));
  assert.ok(endpoint.includes('metadata?.matchday'));
  assert.ok(endpoint.includes('feed.items.sort(compareFeedItems)'));
  assert.ok(!legacyRepair.includes('commit,committed_at'));
});

test('comment mutations bump the affected non-pinned card without reloading the feed', () => {
  assert.ok(ui.includes('function firstUnpinnedCard'));
  assert.ok(ui.includes('existing.remove()'));
  assert.ok(ui.includes('list.insertBefore(node, firstUnpinned)'));
  assert.ok(ui.includes('replaceFeedItem(result.item)'));
});

test('only admins get the pin control and pin writes are server-authorized', () => {
  assert.ok(migration.includes('set_world_feed_item_pinned_for_user'));
  assert.ok(migration.includes('Administrator access required'));
  assert.ok(migration.includes("'can_moderate'"));
  assert.ok(ui.includes('feedCanModerate'));
  assert.ok(ui.includes("action: 'pin'"));
  assert.ok(endpoint.includes("if (action === 'pin')"));
  assert.ok(endpoint.includes('set_world_feed_item_pinned_for_user'));
});
