import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared-world command history resolves player and club IDs to display names', async () => {
  const endpoint = await source('netlify/functions/shared-world.mjs');
  assert.match(endpoint, /function playerName\(world, playerId\)/);
  assert.match(endpoint, /function clubName\(world, clubId\)/);
  assert.match(endpoint, /player_name: playerName\(world, playerId\)/);
  assert.match(endpoint, /other_club_name: clubName\(world, otherClubId\)/);
  assert.match(endpoint, /player_id: playerId, playerId: playerName\(world, playerId\)/);
});

test('production scheduler persists football-language outcomes', async () => {
  const scheduler = await source('netlify/functions/scheduled-world-turn.mjs');
  assert.match(scheduler, /has been registered for competitive selection/);
  assert.match(scheduler, /has been removed from the registered squad/);
  assert.match(scheduler, /contract has been renewed/);
  assert.match(scheduler, /playerName}: \$\{label\.toLowerCase\(\)\}/);
  assert.match(scheduler, /related_player_id: playerId/);
});

test('friendly messages retain raw identifiers for audit and links', async () => {
  const endpoint = await source('netlify/functions/shared-world.mjs');
  const scheduler = await source('netlify/functions/scheduled-world-turn.mjs');
  assert.match(endpoint, /player_id: playerId/);
  assert.match(endpoint, /other_club_id: otherClubId/);
  assert.match(scheduler, /playerId = row\.command_payload/);
  assert.match(scheduler, /commandDisplayWorld/);
});
