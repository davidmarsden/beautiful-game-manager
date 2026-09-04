import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('team selection exposes the full available squad as reserves instead of hiding it below the fold', async () => {
  const source = await read('public/alpha-team-ux-fixes.js');
  assert.match(source, /Reserves \/ available squad/);
  assert.match(source, /Your full registered and available squad is here/);
  assert.match(source, /tray-player:not\(\.assigned\)/);
  assert.match(source, /id = 'reservesJump'/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /min-width: 701px/);
  assert.match(source, /max-width: 1100px/);
  assert.match(source, /grid-template-columns: minmax\(0, 1\.55fr\) minmax\(230px, \.72fr\)/);
});

test('substitute rating badges always use dark text on the Brazil yellow rating stock', async () => {
  const source = await read('public/alpha-team-ux-fixes.js');
  assert.match(source, /#tacticsView \.bench-slot \.player-token > \.player-rating/);
  assert.match(source, /background: var\(--tbg-brazil-yellow, #ffdc02\) !important/);
  assert.match(source, /color: #17212a !important/);
  assert.match(source, /-webkit-text-fill-color: #17212a !important/);
  assert.match(source, /text-shadow: none !important/);
});

test('listed-player Make offer CTA has readable foreground on the dark blue action button', async () => {
  const source = await read('public/alpha-team-ux-fixes.js');
  assert.match(source, /#transfersView \.open-market-actions \[data-open-market-prepare-offer\]/);
  assert.match(source, /background: var\(--tbg-brazil-blue, #193375\) !important/);
  assert.match(source, /color: #fff !important/);
  assert.match(source, /-webkit-text-fill-color: #fff !important/);
  assert.match(source, /color: var\(--tbg-brazil-yellow, #ffdc02\) !important/);
});

test('squad List player shortcut waits for the core transfer refresh before choosing a player', async () => {
  const source = await read('public/alpha-team-ux-fixes.js');
  assert.match(source, /TRANSFER_READY_PATTERN/);
  assert.match(source, /existingStatus\.textContent = 'Preparing player…'/);
  assert.match(source, /document\.querySelector\('\[data-view="transfers"\]'\)\?\.click\(\)/);
  assert.match(source, /waitForTransferRefresh\(status\)/);
  assert.match(source, /action\.value = 'listing'/);
  assert.match(source, /requestedOption = \[\.\.\.select\.options\]\.find/);
  assert.match(source, /select\.value = requestedPlayerId/);
  assert.match(source, /norm\(select\.value\) !== requestedPlayerId/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(source, /fetch\('\/api\/transfer-negotiations'/);
});

test('team UX fixes are loaded by the normal manager portal module chain', async () => {
  const loader = await read('public/internal-profile-links.js');
  assert.match(loader, /import '\.\/alpha-team-ux-fixes\.js';/);
});
