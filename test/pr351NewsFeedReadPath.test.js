import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260826e_alpha_world_feed_read_path.sql', import.meta.url), 'utf8');
const executableSql = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '');

test('News feed read RPC no longer traverses the monolithic world read model', () => {
  assert.match(executableSql, /create or replace function public\.get_manager_world_feed_for_user/i);
  assert.doesNotMatch(executableSql, /world_read_model_cache/i);
  assert.doesNotMatch(executableSql, /canonical_world_saves/i);
});

test('News feed resolves actor and commenter club names from the relational clubs table', () => {
  assert.match(executableSql, /left join public\.clubs comment_club/i);
  assert.match(executableSql, /left join public\.clubs actor_club/i);
  assert.match(executableSql, /coalesce\(comment_club\.name, comment\.club_id\)/i);
  assert.match(executableSql, /coalesce\(actor_club\.name, item\.actor_club_id\)/i);
});

test('News feed computes cheap comment activity before applying the bounded item limit', () => {
  assert.match(executableSql, /with comment_activity as \([\s\S]*max\(comment\.created_at\) as latest_comment_at/i);
  assert.match(executableSql, /limited_items as \([\s\S]*left join comment_activity/i);
  assert.match(executableSql, /limit greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/i);
});

test('News feed only builds full comment JSON for selected feed items', () => {
  assert.match(executableSql, /comment_rows as \([\s\S]*from limited_items limited_item[\s\S]*join public\.world_feed_comments comment/i);
  assert.match(executableSql, /comment\.hidden_at is null/i);
  assert.match(executableSql, /group by comment\.feed_item_id/i);
  assert.match(executableSql, /jsonb_agg\([\s\S]*order by comment\.created_at asc, comment\.id asc/i);
});

test('News feed preserves pinned and activity ordering', () => {
  assert.match(executableSql, /\(item\.pinned_at is not null\) desc/i);
  assert.match(executableSql, /item\.activity_at desc/i);
});
