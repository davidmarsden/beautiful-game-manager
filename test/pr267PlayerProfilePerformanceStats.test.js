import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('player profile loads persisted statistics lazily from the compact endpoint', async () => {
  const source = await read('public/player-profile.js');
  assert.match(source, /data-player-tab="statistics"/);
  assert.match(source, /if \(tab === 'statistics'\) loadStatistics\(panel, player\)/);
  assert.match(source, /\/api\/player-profile-stats\?player_id=/);
  assert.match(source, /average_match_rating/);
  assert.match(source, /Loading season statistics/);
});

test('player profile ignores statistics responses after Statistics is no longer active', async () => {
  const source = await read('public/player-profile.js');
  assert.match(source, /function statisticsStillActive\(panel\)/);
  assert.match(source, /statisticsTab\?\.getAttribute\('aria-selected'\) === 'true'/);
  assert.match(source, /if \(!statisticsStillActive\(panel\)\) return;\s*panel\.innerHTML = statisticsPanel\(stats\)/s);
  assert.match(source, /catch \(error\) \{\s*if \(!statisticsStillActive\(panel\)\) return;/s);
});

test('player profile statistics endpoint is authenticated and appointment-scoped through the RPC', async () => {
  const endpoint = await read('netlify/functions/player-profile-stats.mjs');
  assert.match(endpoint, /\/auth\/v1\/user/);
  assert.match(endpoint, /get_player_profile_performance_stats_for_user/);
  assert.match(endpoint, /p_user_id: user\.id/);
  assert.match(endpoint, /p_player_id: playerId/);
  assert.match(endpoint, /cache-control': 'no-store/);
});

test('performance stats RPC aggregates current-season compact match archives only', async () => {
  const migration = await read('supabase/migrations/20260822_player_profile_performance_stats.sql');
  assert.match(migration, /canonical_match_archives/);
  assert.match(migration, /c\.season_id = current_season_id/);
  assert.match(migration, /player_ratings/);
  assert.match(migration, /'appearances'/);
  assert.match(migration, /'average_match_rating'/);
  assert.match(migration, /event_row ->> 'type' = 'goal'/);
  assert.match(migration, /event_row ->> 'assist_player_id' = p_player_id/);
  assert.match(migration, /grant execute on function public\.get_player_profile_performance_stats_for_user\(uuid,text,text\)\s+to service_role/s);
  assert.match(migration, /revoke all on function public\.get_player_profile_performance_stats_for_user\(uuid,text,text\)\s+from public, anon, authenticated/s);
});

test('performance stats count unrated appearances but average only rated rows', async () => {
  const migration = await read('supabase/migrations/20260822_player_profile_performance_stats.sql');
  assert.match(migration, /appearances as \([\s\S]*rating_row ->> 'player_id' = p_player_id[\s\S]*\), rated as \(/);
  assert.match(migration, /'appearances', \(select count\(\*\)::integer from appearances\)/);
  assert.match(migration, /'average_match_rating', \(select round\(avg\(\(rating_row ->> 'rating'\)::numeric\), 2\) from rated\)/);
  assert.match(migration, /from rated\s+order by played_at desc/);
});

test('performance stats do not credit own goals to the attacking player', async () => {
  const migration = await read('supabase/migrations/20260822_player_profile_performance_stats.sql');
  assert.match(migration, /event_row ->> 'player_id' = p_player_id\s+and coalesce\(event_row ->> 'own_goal', 'false'\) <> 'true'/s);
});
