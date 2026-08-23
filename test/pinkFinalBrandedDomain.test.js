import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PINK_FINAL_BASE_URL, pinkFinalProfileUrl } from '../src/world/pinkFinalPlayerProfile.js';
import { DEFAULT_PINK_FINAL_CLUB_BASE_URL, pinkFinalClubProfileUrl } from '../src/world/pinkFinalClubProfile.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Pink Final defaults use the branded thebeautifulgame.online namespace', () => {
  assert.equal(DEFAULT_PINK_FINAL_BASE_URL, 'https://thebeautifulgame.online/pink-final/players/');
  assert.equal(DEFAULT_PINK_FINAL_CLUB_BASE_URL, 'https://thebeautifulgame.online/pink-final/clubs/');
  assert.equal(
    pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-001' }),
    'https://thebeautifulgame.online/pink-final/players/?id=tbg-player-001'
  );
  assert.equal(
    pinkFinalClubProfileUrl({ club_id: 'club-001' }),
    'https://thebeautifulgame.online/pink-final/clubs/?id=club-001'
  );
});

test('Netlify reverse-proxies the Pink Final namespace to its independent static origin', async () => {
  const config = await read('../netlify.toml');
  assert.match(config, /from = "\/pink-final\/\*"/);
  assert.match(config, /to = "https:\/\/davidmarsden\.github\.io\/beautiful-game-data\/:splat"/);
  assert.match(config, /Cache-Control = "public, max-age=300, stale-while-revalidate=3600"/);
});
