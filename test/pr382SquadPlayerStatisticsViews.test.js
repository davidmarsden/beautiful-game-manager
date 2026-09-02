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

test('every column in every alternate squad view is sortable with the General-view arrow interaction', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /\['Apps', 'stats_apps'\]/);
  assert.match(source, /\['Last 5', 'stats_recent'\]/);
  assert.match(source, /\['Squad status', 'squad_status'\]/);
  assert.match(source, /\['Previous', 'ability_previous'\]/);
  assert.match(source, /\['History', 'ability_history'\]/);
  assert.match(source, /\['Transfer', 'transfer_state'\]/);
  assert.match(source, /\['Loan', 'loan_state'\]/);
  assert.match(source, /header\.dataset\.sort = sortKey/);
  assert.match(source, /header\.dataset\.arrow = state && sortKey === state\.key/);
  assert.match(source, /function sortValue\(player, key\)/);
  assert.match(source, /function sortPlayers\(rows, viewName\)/);
  assert.match(source, /state\.dir = state\.dir === 'asc' \? 'desc' : 'asc'/);
});

test('alternate squad views intercept legacy header sorting before app.js can redraw General rows', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /getElementById\('squadTable'\)\?\.addEventListener\('click'/);
  assert.match(source, /currentView\(\) === 'general'/);
  assert.match(source, /event\.target\.closest\('th\[data-sort\]'\)/);
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

test('statistics renders its own placeholder rows immediately on first selection before async data arrives', () => {
  const manager = read('../public/squad-player-statistics.js');
  const inspected = read('../public/squad-view.js');
  assert.match(manager, /statusMessage\('Loading persisted season statistics…'\);\s*renderRows\(viewName\);\s*try \{ await loadStatistics\(\);/s);
  assert.match(inspected, /status\('Loading persisted season statistics…'\);\s*render\(\);\s*try \{\s*await loadStatistics\(players,/s);
});

test('squad keeps ability, fitness and Last 5 as whole numbers while AvP stays at one decimal place', () => {
  const manager = read('../public/squad-player-statistics.js');
  const inspected = read('../public/squad-view.js');
  for (const source of [manager, inspected]) {
    assert.match(source, /const wholeNumber =/);
    assert.match(source, /Math\.round\(number\)\.toLocaleString\('en-GB'\)/);
    assert.match(source, /const performanceRating =/);
    assert.match(source, /number\.toFixed\(1\)/);
    assert.match(source, /performanceRating\(stats\.average_match_rating\)/);
    assert.match(source, /recent_ratings[\s\S]{0,140}wholeNumber\(row\.rating\)/);
    assert.doesNotMatch(source, /recent_ratings[\s\S]{0,140}performanceRating\(row\.rating\)/);
  }
});

test('player profile shows average match performance to one decimal place', () => {
  const profile = read('../public/player-profile.js');
  assert.match(profile, /average_match_rating\)\.toFixed\(1\)/);
  assert.doesNotMatch(profile, /average_match_rating\)\.toFixed\(2\)/);
});

test('ability view reuses governed rating history rather than inventing a second rating source', () => {
  const source = read('../public/squad-player-statistics.js');
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /latest_change/);
  assert.match(source, /record\.history/);
  assert.doesNotMatch(source, /Math\.random/);
});

test('read-only club inspection exposes the same five data views and sortable columns for other teams', () => {
  const source = read('../public/squad-view.js');
  assert.match(source, /general:\s*\{/);
  assert.match(source, /statistics:\s*\{/);
  assert.match(source, /physical:\s*\{/);
  assert.match(source, /ability:\s*\{/);
  assert.match(source, /contracts:\s*\{/);
  assert.match(source, /Display<select data-squad-data-view>/);
  assert.match(source, /fetch\('\/api\/squad-player-stats'/);
  assert.match(source, /fetch\('\/api\/player-rating-history'/);
  assert.match(source, /data-sort="\$\{key\}"/);
  assert.match(source, /compareValues\(sortValue\(a, sort\.key\)/);
  assert.match(source, /Season statistics unavailable/);
  assert.match(source, /tbg:read-only-squad-rendered/);
});
