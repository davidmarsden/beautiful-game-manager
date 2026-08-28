import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828a_world_feed_social_notifications.sql', import.meta.url), 'utf8');
const targetMigration = fs.readFileSync(new URL('../supabase/migrations/20260828b_world_feed_notification_target.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');

test('News comments support first-class direct replies', () => {
  assert.match(migration, /add column if not exists parent_comment_id uuid references public\.world_feed_comments\(id\)/);
  assert.match(migration, /'parent_comment_id', comment\.parent_comment_id/);
  assert.match(endpoint, /p_parent_comment_id:\s*payload\.parent_comment_id \|\| null/);
  assert.match(feed, /parent_comment_id:\s*input\.dataset\.parentCommentId \|\| null/);
  assert.match(feed, /world-feed-reply-action/);
});

test('News comment writer uses scalar manager assignment valid in PL/pgSQL', () => {
  assert.match(migration, /select profile\.id, profile\.display_name, appointment\.club_id\s+into manager_id_value, manager_display_name, club_id_value/);
  assert.doesNotMatch(migration, /select profile, appointment\.club_id into manager_row, club_id_value/);
  assert.doesNotMatch(migration, /select profile\.\*, appointment\.club_id into manager_row/);
  assert.match(migration, /values\(p_feed_item_id, manager_id_value, club_id_value/);
});

test('News social notifications distinguish post comments from direct replies', () => {
  assert.match(migration, /'news_post_comment'/);
  assert.match(migration, /'news_comment_reply'/);
  assert.match(migration, /item_row\.actor_manager_id <> manager_id_value/);
  assert.match(migration, /parent_row\.manager_id <> manager_id_value/);
  assert.match(migration, /item_row\.actor_manager_id <> parent_row\.manager_id/);
  assert.match(migration, /on conflict\(manager_id, dedupe_key\) do nothing/g);
});

test('News notifications deep-link to the exact post and comment', () => {
  assert.match(migration, /\?view=feed&feed_item=/);
  assert.match(migration, /&comment=/);
  assert.match(feed, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(feed, /data-comment-id/);
  assert.match(feed, /scrollIntoView/);
});

test('notification targets outside the normal feed window use a bounded item RPC', () => {
  assert.match(targetMigration, /get_manager_world_feed_item_for_user/);
  assert.match(targetMigration, /where item\.id = p_feed_item_id/);
  assert.match(targetMigration, /item\.world_id = p_world_id/);
  assert.match(targetMigration, /item\.hidden_at is null/);
  assert.doesNotMatch(targetMigration, /world_read_model_cache|save_envelope/);
  assert.match(endpoint, /new URL\(request\.url\)\.searchParams\.get\('feed_item'\)/);
  assert.match(endpoint, /currentFeedWithTarget/);
  assert.match(endpoint, /get_manager_world_feed_item_for_user/);
  assert.match(feed, /\/api\/world-feed\?feed_item=\$\{encodeURIComponent\(requestedItemId\)\}/);
});

test('deep links expand a collapsed target comment before scrolling', () => {
  assert.match(feed, /target\.hidden/);
  assert.match(feed, /world-feed-comments-toggle\[aria-expanded="false"\]/);
  assert.match(feed, /toggle\?\.click\(\)/);
});

test('reply targets are restricted to visible comments on the same feed item', () => {
  assert.match(migration, /comment\.feed_item_id = p_feed_item_id/);
  assert.match(migration, /comment\.hidden_at is null/);
  assert.match(migration, /raise exception 'Reply target is unavailable'/);
});
