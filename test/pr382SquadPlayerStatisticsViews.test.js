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

test('alternate squad views intercept legacy header sorting before app.js can redraw General rows', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /getElementById\('squadTable'\)\?\.addEventListener\('click'/);
  assert.match(source, /currentView\(\) === 'general'/);
  assert.match(source, /event\.target\.closest\('th'\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /}, true\);/);
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

test('statistics failures stay visibly unavailable instead of being converted into zero totals', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /let statisticsError = null/);
  assert.match(source, /statisticsError = error/);
  assert.match(source, /throw error/);
  assert.match(source, /Season statistics unavailable/);
  assert.match(source, /if \(!stats\) return .*<td>—<\/td>/s);
  assert.doesNotMatch(source, /Could not load squad statistics'[\s\S]{0,120}return \{\}/);
});

test('ability view reuses governed rating history rather than inventing a second rating source', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /latest_change/);
  assert.match(source, /record\.history/);
  assert.doesNotMatch(source, /Math\.random/);
});
