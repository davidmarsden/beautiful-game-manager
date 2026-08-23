import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823k_world_feed_manager_self_hide.sql', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');

test('managers can hide only their own manager posts while admins retain moderation', () => {
  assert.ok(migration.includes("item.item_type = 'manager_post'"));
  assert.ok(migration.includes('item.actor_manager_id = manager_id_value'));
  assert.ok(migration.includes('is_admin_value'));
  assert.ok(migration.includes('hidden_by_manager_id = manager_id_value'));
  assert.ok(migration.includes('You can only hide your own manager posts'));
  assert.ok(endpoint.includes('/Administrator|only hide your own/i'));
});

test('World Feed exposes Hide only for own manager posts or moderators and removes the card in place', () => {
  assert.ok(feed.includes("item.item_type === 'manager_post'"));
  assert.ok(feed.includes("String(item.actor_manager_id || '') === String(feedManagerId || '')"));
  assert.ok(feed.includes("sendFeedAction({ action: 'hide', feed_item_id: item.id })"));
  assert.ok(feed.includes('removeFeedItem(item.id)'));
  assert.ok(feed.includes("feedManagerId = String(data?.manager_id || '')"));
});

test('legacy club navigation is retired while workspace tabs remain authoritative', () => {
  assert.ok(navigation.includes('function retireLegacyClubNav()'));
  assert.ok(navigation.includes('nav.hidden = true'));
  assert.ok(navigation.includes("nav.setAttribute('aria-hidden', 'true')"));
  assert.ok(navigation.includes("nav.style.setProperty('display', 'none', 'important')"));
  assert.ok(navigation.includes('installWorldFeedShell();'));
  assert.ok(navigation.includes("workspace?.querySelector('.tabs')"));
});
