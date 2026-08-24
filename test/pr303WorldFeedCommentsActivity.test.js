import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const enhancement = fs.readFileSync(new URL('../public/world-feed-enhancements.js', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260824a_world_feed_social_activity.sql', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');

test('three or more comments collapse to the latest two with an accessible toggle', () => {
  assert.ok(enhancement.includes('const COMMENT_PREVIEW_LIMIT = 2'));
  assert.ok(enhancement.includes("index < Math.max(0, rows.length - COMMENT_PREVIEW_LIMIT)"));
  assert.ok(enhancement.includes("toggle.setAttribute('aria-expanded', String(expanded))"));
  assert.ok(enhancement.includes('`Show all ${rows.length} comments`'));
  assert.ok(enhancement.includes("'Collapse comments'"));
  assert.ok(enhancement.includes('expandAfterComment.delete(itemId)'));
});

test('social activity is loaded separately from the fast World Feed GET', () => {
  const getStart = endpoint.indexOf("if (request.method === 'GET')");
  const postStart = endpoint.indexOf("if (request.method !== 'POST')", getStart);
  const getBlock = endpoint.slice(getStart, postStart);
  assert.equal(getBlock.includes('get_world_feed_social_activity_for_user'), false);
  assert.ok(endpoint.includes("if (action === 'activity')"));
  assert.ok(endpoint.includes("rpc('get_world_feed_social_activity_for_user'"));
  assert.ok(enhancement.includes("body: JSON.stringify({ action: 'activity' })"));
  assert.ok(enhancement.includes('const ACTIVITY_TTL = 5 * 60_000'));
});

test('cached activity can rebuild a panel after the feed shell is replaced', () => {
  assert.ok(enhancement.includes('let activityCache = null'));
  assert.ok(enhancement.includes('Date.now() - activityLoadedAt < ACTIVITY_TTL && activityCache'));
  assert.ok(enhancement.includes('renderActivity(activityCache)'));
  assert.ok(enhancement.includes('activityCache = data'));
});

test('activity refresh is triggered only after successful post or comment mutations', () => {
  assert.ok(feed.includes("new CustomEvent('tbg:world-feed-mutation-succeeded', { detail: { action: 'comment'"));
  assert.ok(feed.includes("new CustomEvent('tbg:world-feed-mutation-succeeded', { detail: { action: 'post'"));
  assert.ok(enhancement.includes("document.addEventListener('tbg:world-feed-mutation-succeeded'"));
  assert.ok(enhancement.includes("if (!['post', 'comment'].includes(event.detail?.action)) return"));
  assert.equal(enhancement.includes("setTimeout(() => { void loadSocialActivity({ force: true }); }, 1500)"), false);
});

test('social activity measures participation without folding received replies into authored activity', () => {
  assert.ok(migration.includes("item.item_type = 'manager_post'"));
  assert.ok(migration.includes('comment.manager_id = profile.id'));
  assert.ok(migration.includes('comment.manager_id <> profile.id'));
  assert.ok(migration.includes("'social_actions', posts + comments_made"));
  assert.ok(migration.includes("'comments_received_from_others', comments_received_from_others"));
  assert.ok(migration.includes("'last_social_activity_at', last_social_activity_at"));
  assert.ok(migration.includes("'inactive_days'"));
  assert.ok(enhancement.includes('not a measure of club management'));
});

test('manager-wide social activity roster is exposed only to admins', () => {
  assert.ok(migration.includes('if caller_is_admin then'));
  assert.ok(migration.includes("'can_view_roster', caller_is_admin"));
  assert.ok(enhancement.includes('data?.can_view_roster && managers.length'));
  assert.ok(navigation.includes("import './world-feed-enhancements.js';"));
});
