import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectPinkFinalPlayerIdentity } from '../src/world/pinkFinalPlayerProfile.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const BASE_URL = 'https://pink-final.example/players/';

test('generic provider profile URLs never replace Pink Final routes', () => {
  const player = projectPinkFinalPlayerIdentity({
    tbg_player_id: 'tbg-player-courtois',
    display_name: 'Thibaut Courtois',
    profile_url: 'https://www.transfermarkt.com/thibaut-courtois/profil/spieler/108390'
  }, { baseUrl: BASE_URL });

  assert.equal(player.source_profile_url, 'https://www.transfermarkt.com/thibaut-courtois/profil/spieler/108390');
  assert.equal(player.profile_url, 'https://pink-final.example/players/?id=tbg-player-courtois');
  assert.doesNotMatch(player.profile_url, /transfermarkt/i);
});

test('explicit governed Pink Final URLs still override the route-key base', () => {
  const player = projectPinkFinalPlayerIdentity({
    tbg_player_id: 'tbg-player-001',
    profile_url: 'https://www.transfermarkt.com/provider-record',
    pink_final_profile_url: 'https://pink-final.example/footballers/tbg-player-001'
  }, { baseUrl: BASE_URL });

  assert.equal(player.profile_url, 'https://pink-final.example/footballers/tbg-player-001');
  assert.equal(player.source_profile_url, 'https://www.transfermarkt.com/provider-record');
});

test('history projects Pink Final identity for every club squad', async () => {
  const projection = await read('../src/world/historySquadProjection.js');
  const endpoint = await read('../netlify/functions/history.mjs');
  const renderer = await read('../public/squad-view.js');

  assert.match(projection, /projectPinkFinalPlayerIdentity/);
  assert.match(projection, /pinkFinalBaseUrl/);
  assert.match(endpoint, /PINK_FINAL_BASE_URL/);
  assert.match(endpoint, /pinkFinalBaseUrl: PINK_FINAL_BASE_URL/);
  assert.match(renderer, /function playerNameMarkup/);
  assert.match(renderer, /href="\$\{escapeHtml\(player\.profile_url\)\}"/);
  assert.match(renderer, /Pink Final profile not published yet/);
});
