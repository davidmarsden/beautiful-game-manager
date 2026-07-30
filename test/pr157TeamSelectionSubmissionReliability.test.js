import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('reliable submission controller owns form submission before the legacy formation bridge', async () => {
  const html = await read('public/index.html');
  const controllerIndex = html.indexOf('team-selection-submission-reliability.js');
  const boardIndex = html.indexOf('formation-board.js');
  assert.ok(controllerIndex >= 0, 'reliable submission controller must be loaded');
  assert.ok(boardIndex > controllerIndex, 'controller must register its capture handler before the legacy board submit bridge');
  assert.match(html, /team-selection-submission-reliability\.css/);
});

test('submission prefers the visible ordered board but can recover through legacy selectors', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /function boardAvailable\(\)/);
  assert.match(source, /#formationPitch \.formation-slot/);
  assert.match(source, /#formationBench \.bench-slot/);
  assert.match(source, /function legacyPlayerIds\(zone\)/);
  assert.match(source, /input\[data-zone="\$\{zone\}"\]:checked/);
  assert.match(source, /const usingBoard = boardAvailable\(\)/);
  assert.match(source, /usingBoard \? playerIds\('#formationPitch \.formation-slot'\) : legacyPlayerIds\('xi'\)/);
  assert.match(source, /usingBoard \? playerIds\('#formationBench \.bench-slot'\) : legacyPlayerIds\('bench'\)/);
  assert.match(source, /starting_xi: selection\.startingXi/);
  assert.match(source, /bench: selection\.bench/);
});

test('submission validates eleven starters seven substitutes and a starting captain before POST', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /startingXi\.length !== 11/);
  assert.match(source, /bench\.length !== 7/);
  assert.match(source, /new Set\(allPlayers\)\.size !== allPlayers\.length/);
  assert.match(source, /if \(!captainId\)/);
  assert.match(source, /if \(!startingXi\.includes\(captainId\)\)/);
  const validationIndex = source.indexOf('const selection = selectedTeam();');
  const postIndex = source.indexOf("nativeFetch('/api/decisions'");
  assert.ok(validationIndex >= 0 && postIndex > validationIndex, 'selection must be validated before the submission request');
});

test('captain choices stay synchronized with either rendered team selector', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /function synchronizeCaptainChoices\(startingXi\)/);
  assert.match(source, /boardAvailable\(\) \? playerIds/);
  assert.match(source, /legacyPlayerIds\('xi'\)/);
  assert.match(source, /captain\.replaceChildren/);
  assert.match(source, /orderedXi\.includes\(previousCaptain\)/);
  assert.match(source, /new MutationObserver\(\(\) => synchronizeCaptainChoices\(\)\)/);
  assert.match(source, /document\.addEventListener\('change', \(event\) => \{/);
  assert.match(source, /event\.target\?\.matches\('input\[data-zone="xi"\]'\)/);
  assert.match(source, /synchronizeCaptainChoices\(legacyPlayerIds\('xi'\)\)/);
});

test('bootstrap state is reused for preflight while manager writes invalidate the shared cache', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /let cachedPortalState = window\.tbgPortalState \|\| null/);
  assert.match(source, /window\.tbgInvalidateBootstrapCache\?\.\(\)/);
  assert.doesNotMatch(source, /window\.fetch = async/);
  assert.match(source, /const canonical = cachedPortalState \|\| window\.tbgPortalState \|\| await bootstrapState\(\)/);
  const selectionIndex = source.indexOf('const selection = selectedTeam();');
  const canonicalIndex = source.indexOf('const canonical = cachedPortalState');
  assert.ok(selectionIndex >= 0 && canonicalIndex > selectionIndex, 'local validation should happen before any fallback bootstrap request');
});

test('canonical rejection clears stale fixture state and refreshes before the next retry', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /function invalidatePortalState\(\)/);
  assert.match(source, /cachedPortalState = null/);
  assert.match(source, /window\.tbgPortalState = null/);
  assert.match(source, /if \(response\.status === 409\)/);
  assert.match(source, /const refreshed = await refreshAfterCanonicalRejection\(\)/);
  assert.match(source, /const refreshed = await bootstrapState\(\)/);
  assert.match(source, /fixture state has been refreshed; review the team and save again/);
});

test('formation board keeps retrying after a slow or failed initial portal load', async () => {
  const source = await read('public/formation-board.js');
  assert.match(source, /if \(board\?\.isConnected\) return true/);
  assert.match(source, /if \(!collectPlayers\(\)\) return false/);
  assert.match(source, /scheduleBoardBuild\(500\)/);
  assert.doesNotMatch(source, /attempt < 60/);
  assert.match(source, /window\.addEventListener\('tbg:portal-rendered'/);
  assert.match(source, /tbg:formation-board-ready/);
});

test('submission exposes saving success and exact failures beside a disabled save button', async () => {
  const [source, css] = await Promise.all([
    read('public/team-selection-submission-reliability.js'),
    read('public/team-selection-submission-reliability.css')
  ]);
  assert.match(source, /button\.disabled = true/);
  assert.match(source, /button\.textContent = 'Saving…'/);
  assert.match(source, /setStatus\('Saving…'\)/);
  assert.match(source, /validation_errors/);
  assert.match(source, /invalid response/);
  assert.match(source, /empty response/);
  assert.match(source, /team-submission-actions/);
  assert.match(css, /team-submission-actions/);
});

test('successful POST is only confirmed after exact canonical read-back', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  const successfulResponseIndex = source.indexOf('const submittedAt = result.submitted_at');
  const canonicalRefreshIndex = source.indexOf('refreshed = await refreshCanonicalState();', successfulResponseIndex);
  const outerCatchIndex = source.indexOf("setStatus(error?.message || 'Team selection could not be saved.'", canonicalRefreshIndex);
  assert.ok(successfulResponseIndex >= 0 && canonicalRefreshIndex > successfulResponseIndex, 'POST success must be followed by canonical read-back');
  assert.ok(outerCatchIndex > canonicalRefreshIndex, 'transport and pre-save failures should reach the outer error state');
  assert.match(source, /canonicalMatchesPayload\(refreshed, payload\)/);
  assert.match(source, /canonical read-back could not yet confirm the exact team/);
  assert.match(source, /confirmed after timeout/);
  assert.match(source, /refresh_error: refreshError\?\.message \|\| null/);
});

test('Supabase requests separate API keys from optional bearer credentials', async () => {
  const [bootstrap, decisions] = await Promise.all([
    read('netlify/functions/bootstrap.mjs'),
    read('netlify/functions/decisions.mjs')
  ]);
  for (const source of [bootstrap, decisions]) {
    assert.match(source, /const isJwt = \(value\) => String\(value \|\| ''\)\.split\('\.'\)\.length === 3/);
    assert.match(source, /apikey: apiKey/);
    assert.match(source, /if \(bearer/);
    assert.match(source, /authorization = `Bearer \$\{bearer/);
    assert.match(source, /apiKey: SUPABASE_ANON_KEY/);
    assert.match(source, /bearer: token/);
    assert.match(source, /isJwt\(SUPABASE_SERVICE_ROLE_KEY\) \? \{ bearer: SUPABASE_SERVICE_ROLE_KEY \} : \{\}/);
    assert.doesNotMatch(source, /apikey: token/);
  }
});

test('authorised canonical reads and writes use the server path after identity verification', async () => {
  const [bootstrap, decisions, migration] = await Promise.all([
    read('netlify/functions/bootstrap.mjs'),
    read('netlify/functions/decisions.mjs'),
    read('supabase/migrations/20260729_pr159_manager_portal_world_fragment.sql')
  ]);
  assert.match(bootstrap, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(bootstrap, /const \{ user, manager, appointment \} = await identity\(token\)/);
  assert.match(bootstrap, /serverSupabase\('\/rest\/v1\/rpc\/get_manager_portal_world_fragment'/);
  assert.match(bootstrap, /serverSupabase\(`\/rest\/v1\/manager_turn_submissions/);
  assert.doesNotMatch(bootstrap, /save_envelope/);
  assert.match(decisions, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(decisions, /manager\.id !== payload\.manager_id/);
  assert.match(decisions, /if \(!appointment \|\| appointment\.manager_id !== manager\.id\) return response\(\{ error: 'You are not appointed to this club'/);
  assert.match(decisions, /serverRest\('\/rest\/v1\/rpc\/get_manager_portal_world_fragment'/);
  assert.match(decisions, /serverRest\('\/rest\/v1\/manager_turn_submissions/);
  assert.doesNotMatch(decisions, /save_envelope/);
  assert.match(migration, /from public\.canonical_world_saves/);
});