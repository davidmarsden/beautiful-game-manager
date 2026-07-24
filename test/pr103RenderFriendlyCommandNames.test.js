import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('World history prefers friendly display names over raw command IDs', async () => {
  const controls = await source('public/world-controls.js');
  assert.match(controls, /display\.player_name \|\| payload\.player_name/);
  assert.match(controls, /display\.other_club_name \|\| payload\.other_club_name/);
  assert.doesNotMatch(controls, /const player = payload\.playerId \|\| payload\.player_id;/);
});

test('World history retains raw identifiers only as technical references', async () => {
  const controls = await source('public/world-controls.js');
  assert.match(controls, /function commandTechnicalDetails\(command\)/);
  assert.match(controls, /Reference/);
  assert.match(controls, /display\.player_id \|\| payload\.playerId/);
  assert.match(controls, /display\.other_club_id \|\| payload\.otherClubId/);
});
