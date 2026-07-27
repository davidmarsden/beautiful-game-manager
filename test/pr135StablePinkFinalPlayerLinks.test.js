import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  pinkFinalProfileUrl,
  projectPinkFinalPlayerIdentity,
  projectPinkFinalSquadLinks
} from '../src/world/pinkFinalPlayerProfile.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const BASE_URL = 'https://pink-final.example/players/';

test('Pink Final links use immutable player identity rather than display names', () => {
  const first = pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-001', display_name: 'Alex Smith' }, { baseUrl: BASE_URL });
  const second = pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-002', display_name: 'Alex Smith' }, { baseUrl: BASE_URL });

  assert.equal(first, 'https://pink-final.example/players/?id=tbg-player-001');
  assert.equal(second, 'https://pink-final.example/players/?id=tbg-player-002');
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /Alex|Smith/);
});

test('accents do not affect profile identity', () => {
  const accented = pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-joao-001', display_name: 'João Félix' }, { baseUrl: BASE_URL });
  const renamed = pinkFinalProfileUrl({ tbg_player_id: 'tbg-player-joao-001', display_name: 'Joao Felix' }, { baseUrl: BASE_URL });

  assert.equal(accented, renamed);
  assert.equal(accented, 'https://pink-final.example/players/?id=tbg-player-joao-001');
});

test('explicit public URLs and route keys survive future Pink Final route changes', () => {
  const explicit = projectPinkFinalPlayerIdentity({
    tbg_player_id: 'tbg-player-003',
    display_name: 'Route Test',
    profile_url: 'https://pink-final.example/footballers/stable-003'
  }, { baseUrl: BASE_URL });
  const routed = projectPinkFinalPlayerIdentity({
    tbg_player_id: 'legacy-id',
    pink_final_route_key: 'public-player-key-003',
    display_name: 'Route Test'
  }, { baseUrl: 'https://pink-final.example/new-player-route/' });

  assert.equal(explicit.profile_url, 'https://pink-final.example/footballers/stable-003');
  assert.equal(routed.profile_url, 'https://pink-final.example/new-player-route/?id=public-player-key-003');
  assert.equal(routed.pink_final_route_key, 'public-player-key-003');
});

test('unpublished profiles project an honest non-link state', () => {
  const player = projectPinkFinalPlayerIdentity({
    tbg_player_id: 'tbg-player-004',
    display_name: 'Not Published',
    profile_published: false
  }, { baseUrl: BASE_URL });

  assert.equal(player.profile_url, null);
  assert.equal(player.pink_final_profile_status, 'unpublished');
});

test('every projected squad player receives stable profile metadata', () => {
  const projection = projectPinkFinalSquadLinks({ squad: [
    { tbg_player_id: 'tbg-player-005', display_name: 'Published Player' },
    { tbg_player_id: 'tbg-player-006', display_name: 'Unpublished Player', publication_status: 'unpublished' }
  ] }, { baseUrl: BASE_URL });

  assert.equal(projection.squad[0].profile_url, 'https://pink-final.example/players/?id=tbg-player-005');
  assert.equal(projection.squad[0].pink_final_profile_status, 'published');
  assert.equal(projection.squad[1].profile_url, null);
  assert.equal(projection.squad[1].pink_final_profile_status, 'unpublished');
});

test('Manager Portal renders links from projected URLs and replaces unavailable anchors', async () => {
  const app = await read('../public/app.js');
  const fallback = await read('../public/stable-player-links.js');
  const bootstrap = await read('../netlify/functions/bootstrap.mjs');

  assert.match(app, /href="\$\{player\.profile_url\}"/);
  assert.match(app, /target="_blank" rel="noopener"/);
  assert.match(fallback, /Pink Final profile not published yet/);
  assert.match(fallback, /INVALID_PROFILE_HREFS/);
  assert.match(fallback, /MutationObserver/);
  assert.match(bootstrap, /projectPinkFinalSquadLinks/);
  assert.match(bootstrap, /PINK_FINAL_BASE_URL/);
});
