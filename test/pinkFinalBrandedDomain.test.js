import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PINK_FINAL_BASE_URL, pinkFinalProfileUrl } from '../src/world/pinkFinalPlayerProfile.js';
import { DEFAULT_PINK_FINAL_CLUB_BASE_URL, pinkFinalClubProfileUrl } from '../src/world/pinkFinalClubProfile.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Pink Final defaults use the dedicated thepinkfinal.online origin', () => {
  assert.equal(DEFAULT_PINK_FINAL_BASE_URL, 'https://thepinkfinal.online/players/');
  assert.equal(DEFAULT_PINK_FINAL_CLUB_BASE_URL, 'https://thepinkfinal.online/clubs/');
  assert.equal(
    pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-001' }),
    'https://thepinkfinal.online/players/?id=tbg-player-001'
  );
  assert.equal(
    pinkFinalClubProfileUrl({ club_id: 'club-001' }),
    'https://thepinkfinal.online/clubs/?id=club-001'
  );
});

test('legacy TBG Pink Final routes permanently redirect to the dedicated domain', async () => {
  const config = await read('../netlify.toml');
  assert.match(config, /from = "\/pink-final"[\s\S]*to = "https:\/\/thepinkfinal\.online\/"[\s\S]*status = 301/);
  assert.match(config, /from = "\/pink-final\/\*"[\s\S]*to = "https:\/\/thepinkfinal\.online\/:splat"[\s\S]*status = 301/);
  assert.doesNotMatch(config, /davidmarsden\.github\.io\/beautiful-game-data\/:splat/);
});
