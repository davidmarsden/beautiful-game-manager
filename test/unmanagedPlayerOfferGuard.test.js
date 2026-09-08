import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('unmanaged club players are classified inside the main profile action mount', async () => {
  const actions = await read('../public/player-profile-actions.js');
  const profile = await read('../public/player-profile.js');
  assert.match(profile, /host\._tbgPlayerProfileContext = \{ player, club \}/);
  assert.match(actions, /const directContext = host\._tbgPlayerProfileContext/);
  assert.match(actions, /const unmanagedPlayer = Boolean\(clubId && !ownPlayer && directory && !manager\)/);
  assert.match(actions, /unmanagedPlayer \? 'Unmanaged club'/);
  assert.match(actions, /direct transfer offers are not available/);
  assert.match(actions, /You can still shortlist the player/);
  assert.match(actions, /const offerDisabled = ownPlayer \|\| unmanagedPlayer \|\| Boolean\(directoryError\)/);
});

test('managed clubs and free agents keep their valid actions', async () => {
  const actions = await read('../public/player-profile-actions.js');
  assert.match(actions, /!clubId \? 'Offer contract'/);
  assert.match(actions, /managedPlayer \? 'Make offer'/);
  assert.match(actions, /const managedPlayer = Boolean\(manager\?\.manager_id\)/);
  assert.match(actions, /Contact \$\{manager\.manager_name/);
});

test('opening a profile no longer requires a second global player lookup when direct context is present', async () => {
  const actions = await read('../public/player-profile-actions.js');
  assert.match(actions, /directResult \|\| resolveProfile\(id\)/);
  assert.match(actions, /Promise\.resolve\(directResult \|\| resolveProfile\(id\)\)/);
});
