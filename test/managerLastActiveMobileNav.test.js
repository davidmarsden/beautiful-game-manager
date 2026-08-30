import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260830_manager_last_active.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/manager-participation.mjs', import.meta.url), 'utf8');
const directory = fs.readFileSync(new URL('../public/manager-directory.js', import.meta.url), 'utf8');
const presence = fs.readFileSync(new URL('../public/portal-presence.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/portal-presence.css', import.meta.url), 'utf8');

test('manager activity is world-scoped and exposed through the manager directory', () => {
  assert.ok(migration.includes('create table if not exists public.manager_world_activity'));
  assert.ok(migration.includes('primary key (manager_id, world_id)'));
  assert.ok(endpoint.includes("body.action === 'touch-activity'"));
  assert.ok(endpoint.includes('last_active_at: activeTimes.get'));
  assert.ok(directory.includes('Last active'));
  assert.ok(directory.includes('active in 24h'));
  assert.ok(directory.includes('in 3 days'));
});

test('portal activity is throttled rather than writing on every interaction', () => {
  assert.ok(presence.includes('const ACTIVITY_INTERVAL = 5 * 60_000'));
  assert.ok(presence.includes("body: JSON.stringify({ action: 'touch-activity' })"));
  assert.ok(presence.includes("document.addEventListener('pointerdown'"));
  assert.ok(presence.includes("document.addEventListener('visibilitychange'"));
});

test('overflowing portal tabs get visible left and right navigation affordances', () => {
  assert.ok(presence.includes("right.setAttribute('aria-label', 'Scroll menu right for more pages')"));
  assert.ok(presence.includes("tabs.scrollBy({ left: direction"));
  assert.ok(presence.includes('revealActiveTab'));
  assert.ok(styles.includes('.portal-tabs-scroll-shell.portal-tabs-can-right::after'));
  assert.ok(styles.includes('.portal-tabs-scroll-button'));
});
