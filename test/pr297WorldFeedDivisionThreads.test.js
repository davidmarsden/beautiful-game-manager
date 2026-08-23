import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823i_world_feed_division_threads.sql', import.meta.url), 'utf8');
const dedupe = fs.readFileSync(new URL('../supabase/migrations/20260823j_world_feed_division_thread_body_dedupe.sql', import.meta.url), 'utf8');

test('matchday system posts are deliberate division-scoped discussion threads', () => {
  assert.ok(migration.includes("'matchday_completed:' || thread.season_id || ':' || thread.division_key || ':' || thread.matchday::text"));
  assert.ok(migration.includes("'thread_scope', 'division'"));
  assert.ok(migration.includes("'division_key', thread.division_key"));
  assert.ok(migration.includes("'club_ids', to_jsonb(thread.club_ids)"));
  assert.ok(migration.includes("'Division ' || coalesce(thread.division_number::text"));
});

test('post-match threads contain real runtime scores and invite reaction', () => {
  assert.ok(migration.includes("runtime.runtime_value->'results'"));
  assert.ok(migration.includes("runtime.runtime_value->'archive_results'"));
  assert.ok(migration.includes("value #>> '{score,home}'"));
  assert.ok(migration.includes("value #>> '{score,away}'"));
  assert.ok(migration.includes('Managers: post your reaction below.'));
});

test('current matchday gets one press-conference thread per division with real fixtures', () => {
  assert.ok(migration.includes("'matchday_press_conference'"));
  assert.ok(migration.includes("runtime.runtime_value->'fixtures'"));
  assert.ok(migration.includes("'matchday_press:' || thread.season_id || ':' || thread.division_key || ':' || thread.matchday::text"));
  assert.ok(migration.includes('Predictions, team news, selection headaches, mind games?'));
});

test('legacy generic matchday cards retire without throwing away comments', () => {
  assert.ok(migration.includes('set feed_item_id = moves.target_id'));
  assert.ok(migration.includes("coalesce(target.metadata->'club_ids', '[]'::jsonb) ? comment.club_id"));
  assert.ok(migration.includes("coalesce(metadata->>'thread_scope', '') <> 'division'"));
  assert.ok(migration.includes("where item_type = 'matchday_upcoming'"));
});

test('division fixture/result lines are normalised after club membership aggregation', () => {
  assert.ok(dedupe.includes('string_agg(distinct line'));
  assert.ok(dedupe.includes('sync_world_feed_system_items_division_raw'));
  assert.ok(dedupe.includes("item.item_type in ('matchday_completed', 'matchday_press_conference')"));
});
