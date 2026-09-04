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
  assert.match(source, /#tacticsView \.bench-slot \.player-rating/);
  assert.match(source, /background: var\(--tbg-brazil-yellow, #ffdc02\) !important/);
  assert.match(source, /color: #17212a !important/);
});

test('squad List player shortcut reloads authoritative transfer directory instead of relying on a stale DOM retry', async () => {
  const source = await read('public/alpha-team-ux-fixes.js');
  assert.match(source, /fetch\('\/api\/transfer-negotiations'/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /if \(data\.processing && attempt < 8\)/);
  assert.match(source, /data\.directory\?\.players/);
  assert.match(source, /player\.club_id\) === ownClubId/);
  assert.match(source, /requestedPlayerId/);
  assert.match(source, /action\.value = 'listing'/);
  assert.match(source, /select\.innerHTML = ownPlayers\.map\(playerOption\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('team UX fixes are loaded by the normal manager portal module chain', async () => {
  const loader = await read('public/internal-profile-links.js');
  assert.match(loader, /import '\.\/alpha-team-ux-fixes\.js';/);
});
