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
