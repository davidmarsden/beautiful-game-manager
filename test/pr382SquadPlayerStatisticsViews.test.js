import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('manager squad adds SMW-style multi-view player data without replacing the canonical general table', () => {
  const source = read('../public/squad-player-statistics.js');
  const loader = read('../public/internal-profile-links.js');
  assert.match(loader, /import '\.\/squad-player-statistics\.js'/);
  assert.match(source, /general:\s*\{/);
  assert.match(source, /statistics:\s*\{/);
  assert.match(source, /physical:\s*\{/);
  assert.match(source, /ability:\s*\{/);
  assert.match(source, /contracts:\s*\{/);
  assert.match(source, /Display<select id="squadDataView"/);
  assert.match(source, /dispatchEvent\(new Event\('change'/);
  assert.match(source, /data-tbg-player-id/);
});

test('statistics view reads persisted canonical match statistics through one authenticated batch request', () => {
  const source = read('../public/squad-player-statistics.js');
  const endpoint = read('../netlify/functions/squad-player-stats.mjs');
  assert.match(source, /fetch\('\/api\/squad-player-stats'/);
  assert.match(source, /appearances/);
  assert.match(source, /goals/);
  assert.match(source, /assists/);
  assert.match(source, /average_match_rating/);
  assert.match(source, /recent_ratings/);
  assert.match(endpoint, /request\.method !== 'POST'/);
  assert.match(endpoint, /\/auth\/v1\/user/);
  assert.match(endpoint, /new Set/);
  assert.match(endpoint, /ids\.length > 50/);
  assert.match(endpoint, /get_player_profile_performance_stats_for_user/);
  assert.match(endpoint, /Object\.fromEntries\(entries\)/);
});

test('ability view reuses governed rating history rather than inventing a second rating source', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /latest_change/);
  assert.match(source, /record\.history/);
  assert.doesNotMatch(source, /Math\.random/);
});
