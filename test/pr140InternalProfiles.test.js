import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('player links open authenticated TBG profiles before Pink Final', async () => {
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const routing = await readFile(new URL('../public/internal-profile-links.js', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../public/player-profile.js', import.meta.url), 'utf8');
  assert.match(index, /internal-profile-links\.js/);
  assert.match(routing, /event\.preventDefault\(\)/);
  assert.match(routing, /openTbgPlayerProfile/);
  assert.match(routing, /\/api\/history/);
  assert.match(routing, /closest\('\.player-link'\)/);
  assert.doesNotMatch(routing, /contains\('player-link-unavailable'\)/);
  assert.match(profile, /TBG PLAYER PROFILE/);
  assert.match(profile, /Real-world profile/);
  assert.match(profile, /View in The Pink Final/);
  assert.match(profile, /tbg-pink-final-link/);
  assert.match(profile, /Selection/);
  assert.match(profile, /Transfers/);
  assert.match(profile, /Statistics/);
  assert.match(profile, /History/);
});