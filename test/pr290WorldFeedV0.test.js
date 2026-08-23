import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823d_world_feed_v0.sql', import.meta.url), 'utf8');
const postFix = fs.readFileSync(new URL('../supabase/migrations/20260823e_world_feed_v0_post_fix.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');

test('World Feed is deliberately outside the canonical checkpoint', () => {
  assert.ok(migration.includes('create table if not exists public.world_feed_items'));
  assert.ok(migration.includes('create table if not exists public.world_feed_comments'));
  assert.equal(migration.includes('update public.canonical_world_saves'), false);
  assert.equal(migration.includes('insert into public.canonical_world_saves'), false);
});

test('system items are idempotent and derive from authoritative application state', () => {
  assert.ok(migration.includes('world_feed_items_world_source_key_unique'));
  assert.ok(migration.includes("'transfer:' || deal.id::text"));
  assert.ok(migration.includes("'matchday_upcoming:' || canonical_row.matchday::text"));
  assert.ok(migration.includes("'matchday_completed:' || previous_matchday::text"));
  assert.ok(migration.includes('on conflict (world_id, source_key)'));
  assert.ok(migration.includes("deal.status = 'completed'"));
  assert.ok(migration.includes('transfer_deal_legs'));
});

test('manager identity for posts and comments is derived from authenticated user', () => {
  assert.ok(postFix.includes('where profile.user_id = p_user_id'));
  assert.ok(postFix.includes("appointment.status = 'active'"));
  assert.ok(migration.includes('create_manager_world_feed_comment_for_user'));
  assert.ok(endpoint.includes('const user = await identity(token)'));
  assert.ok(endpoint.includes('p_user_id: user.id'));
  assert.equal(endpoint.includes('payload.manager_id'), false);
  assert.equal(endpoint.includes('payload.club_id'), false);
});

test('World Feed UI supports manager posts and comments without unsafe HTML rendering', () => {
  assert.ok(navigation.includes("['feed', 'feed']"));
  assert.ok(navigation.includes("['newsfeed', 'feed']"));
  assert.ok(navigation.includes('installWorldFeedShell'));
  assert.ok(ui.includes("action: 'post'"));
  assert.ok(ui.includes("action: 'comment'"));
  assert.ok(ui.includes('textContent'));
  assert.equal(ui.includes('innerHTML = item.body'), false);
  assert.equal(ui.includes('innerHTML = comment.body'), false);
});

test('World Feed tables are service-only and moderation is available', () => {
  assert.ok(migration.includes('alter table public.world_feed_items enable row level security'));
  assert.ok(migration.includes('alter table public.world_feed_comments enable row level security'));
  assert.ok(migration.includes('revoke all on public.world_feed_items from public, anon, authenticated'));
  assert.ok(migration.includes('hide_world_feed_item_for_user'));
  assert.ok(migration.includes('Administrator access required'));
});
