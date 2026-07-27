import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('requested club survives the magic-link callback without being overwritten by browsing', async () => {
  const links = await readFile(new URL('../public/stable-club-links.js', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../public/auth-entry.js', import.meta.url), 'utf8');
  assert.match(links, /event\.target\?\.id === 'loginForm'/);
  assert.match(links, /rememberRequestedClub\(requested\)/);
  assert.doesNotMatch(links, /rememberRequestedClub\(requested\);\s*document\.addEventListener/s);
  assert.match(auth, /localStorage\.getItem\(PENDING_CLUB_KEY\)/);
  assert.match(auth, /url\.searchParams\.set\("club", pendingClubId\)/);
});

test('History club inspection receives the Pink Final action', async () => {
  const history = await readFile(new URL('../public/history.js', import.meta.url), 'utf8');
  assert.match(history, /addPinkFinalClubLink\(panel, club\)/);
  assert.match(history, /View in The Pink Final/);
  assert.match(history, /club\.pink_final_club_profile_url/);
});
