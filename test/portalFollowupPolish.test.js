import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('news adds transfer-style category tabs and tablet-friendly reading columns', async () => {
  const [behaviour, css, managerDirectory] = await Promise.all([
    read('public/portal-followup.js'),
    read('public/portal-followup.css'),
    read('public/manager-directory.js')
  ]);

  assert.match(managerDirectory, /import '\.\/portal-followup\.js'/);
  assert.match(behaviour, /\['all', 'All news'\]/);
  assert.match(behaviour, /\['matchdays', 'Matchdays'\]/);
  assert.match(behaviour, /\['transfers', 'Transfers'\]/);
  assert.match(behaviour, /\['managers', 'Managers'\]/);
  assert.match(behaviour, /\['community', 'Community'\]/);
  assert.match(behaviour, /world-feed-matchday_press_conference/);
  assert.match(behaviour, /MutationObserver/);
  assert.match(behaviour, /mutations\.some\(mutationContainsFeedCard\)/);
  assert.match(behaviour, /node\.matches\?\.\('\.world-feed-item, \.world-feed-list, \.world-feed-shell'\)/);
  assert.match(behaviour, /countNode\.textContent !== count/);
  assert.match(css, /#feedView \.world-feed-category-tabs/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:980px\)/);
});

test('inbox uses the shared hierarchy and two reading columns on wide screens', async () => {
  const css = await read('public/portal-followup.css');

  assert.match(css, /#dashboardView #portalOverview>article/);
  assert.match(css, /#dashboardView #inboxList\{/);
  assert.match(css, /#dashboardView #inboxList\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:980px\)\{[\s\S]*#dashboardView #inboxList\{grid-template-columns:1fr\}/);
  assert.match(css, /var\(--tbg-colour-cream,#f8f7e8\)/);
  assert.match(css, /var\(--tbg-brazil-blue,#193375\)/);
  assert.match(css, /var\(--tbg-brazil-yellow,#FFDC02\)/);
  assert.match(css, /#squadView \.player-link/);
  assert.match(css, /#updatesView \.player-updates-hero/);
  assert.match(css, /#updatesView \.player-update-card/);
});

test('squad transfer status is distinct and unlisted players have a direct listing action', async () => {
  const [behaviour, css] = await Promise.all([
    read('public/portal-followup.js'),
    read('public/portal-followup.css')
  ]);

  assert.match(behaviour, /action\.dataset\.squadListPlayer = playerId/);
  assert.match(behaviour, /action\.textContent = 'List player'/);
  assert.match(behaviour, /attributeFilter: \['data-tbg-player-id'\]/);
  assert.match(behaviour, /document\.querySelector\('\[data-view="transfers"\]'\)\?\.click\(\)/);
  assert.match(behaviour, /action\.value = 'listing'/);
  assert.match(behaviour, /find\(\(option\) => option\.value === playerId\)/);
  assert.match(behaviour, /refreshedPlayer\.value = playerId/);
  assert.match(behaviour, /refreshedPlayer\.value !== playerId/);
  assert.match(css, /#squadView \.squad-transfer-list-action/);
  assert.match(css, /#squadView \.badge\.transfer/);
  assert.match(css, /#squadView \.badge\.loan/);
  assert.match(css, /#squadView \.badge\.loaned/);
});

test('live transfer listings are re-read and reflected in Squad and Transfers immediately', async () => {
  const behaviour = await read('public/portal-followup.js');

  assert.match(behaviour, /followupFetch\('\/api\/transfer-deals'/);
  assert.match(behaviour, /cache: 'no-store'/);
  assert.match(behaviour, /refreshLiveTransferPresentation\(\)/);
  assert.match(behaviour, /listing\.is_own_listing && listing\.status === 'active'/);
  assert.match(behaviour, /makeLiveListedBadge/);
  assert.match(behaviour, /badge\.dataset\.liveTransferListing = 'true'/);
  assert.match(behaviour, /renderLiveTransferListings/);
  assert.match(behaviour, /data-withdraw-listing/);
  assert.match(behaviour, /event\.detail\?\.view === 'squad'/);
  assert.match(behaviour, /event\.detail\?\.view === 'transfers'/);
});

test('live listing refresh observes actual command completion and preserves parallel loan states', async () => {
  const behaviour = await read('public/portal-followup.js');

  assert.match(behaviour, /watchTransferMutationCompletion/);
  assert.match(behaviour, /Player listed immediately\|Transfer listing withdrawn immediately/);
  assert.match(behaviour, /observer\.observe\(message, \{ childList: true, characterData: true, subtree: true \}\)/);
  assert.match(behaviour, /staleControls\.forEach\(\(control\) => control\.remove\(\)\)/);
  assert.match(behaviour, /if \(!existingBadge\) statusCell\.append\(makeLiveListedBadge\(listing\)\)/);
  assert.match(behaviour, /if \(!existingAction\) statusCell\.append\(makeListPlayerAction\(playerId\)\)/);
  assert.doesNotMatch(behaviour, /statusCell\.replaceChildren\(makeLiveListedBadge/);
});

test('squad transfer observer cannot trigger itself into a DOM mutation loop', async () => {
  const behaviour = await read('public/portal-followup.js');
  const observerBlock = behaviour.match(/observer\.observe\(body, \{[\s\S]*?\}\);/)?.[0] || '';

  assert.match(observerBlock, /attributes: true/);
  assert.match(observerBlock, /subtree: true/);
  assert.doesNotMatch(observerBlock, /childList: true/);
  assert.match(behaviour, /const existingBadge = statusCell\.querySelector\('\[data-live-transfer-listing\]'\)/);
  assert.match(behaviour, /if \(!existingBadge\) statusCell\.append\(makeLiveListedBadge\(listing\)\)/);
  assert.match(behaviour, /const existingAction = statusCell\.querySelector\('\[data-squad-list-player\]'\)/);
  assert.match(behaviour, /if \(!existingAction\) statusCell\.append\(makeListPlayerAction\(playerId\)\)/);
});

test('live listing reconciliation changes only the listed count so legacy offer counts survive', async () => {
  const behaviour = await read('public/portal-followup.js');

  assert.match(behaviour, /function updateListedSummaryCount\(listingCount\)/);
  assert.match(behaviour, /current\.replace\(\/·\\s\+\\d\+\\s\+listed\\s\*\$\/, `· \$\{listingCount\} listed`\)/);
  assert.doesNotMatch(behaviour, /liveTransferMarket\.incoming_offers \|\| \[\]\)\.length.*liveTransferMarket\.outgoing_offers/s);
});

test('manager directory resolves canonical club names instead of exposing club ids when available', async () => {
  const fn = await read('netlify/functions/manager-participation.mjs');

  assert.match(fn, /get_manager_transfer_directory_for_user/);
  assert.match(fn, /clubNamesForWorld\(userId, worldId\)/);
  assert.match(fn, /club_name: clubNames\.get\(String\(row\.club_id\)\) \|\| row\.club_id/);
  assert.match(fn, /managerDirectory\(context\.worldId, context\.managerId, user\.id\)/);
});
