import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('unmanaged club players cannot start impossible transfer offers', async () => {
  const guard = await read('../public/unmanaged-player-offer-guard.js');
  const links = await read('../public/internal-profile-links.js');
  assert.match(links, /import '\.\/unmanaged-player-offer-guard\.js'/);
  assert.match(guard, /Checking availability…/);
  assert.match(guard, /managerForClub\(directory, clubId\)/);
  assert.match(guard, /button\.disabled = true/);
  assert.match(guard, /button\.textContent = 'Unmanaged club'/);
  assert.match(guard, /direct transfer offers are not available/);
  assert.match(guard, /You can still shortlist the player/);
});

test('managed clubs and free agents keep their valid actions', async () => {
  const guard = await read('../public/unmanaged-player-offer-guard.js');
  assert.match(guard, /button\.textContent = 'Make offer'/);
  assert.match(guard, /button\.textContent = 'Offer contract'/);
  assert.match(guard, /manager\?\.manager_id/);
});
