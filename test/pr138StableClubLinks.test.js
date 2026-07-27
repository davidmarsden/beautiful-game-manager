import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  pinkFinalClubProfileUrl,
  pinkFinalClubPublicationState,
  pinkFinalClubRouteKey,
  projectPinkFinalClubIdentity
} from '../src/world/pinkFinalClubProfile.js';
import { requestedTbgClubId, tbgClubEntryUrl } from '../public/stable-club-route.js';

test('Pink Final club routes depend on immutable identity rather than labels or division', () => {
  const before = pinkFinalClubProfileUrl({ club_id: 'club-hamburg', club_name: 'Hamburger SV', division_name: 'Division 2' });
  const after = pinkFinalClubProfileUrl({ club_id: 'club-hamburg', club_name: 'Hamburg', division_name: 'Division 1' });
  assert.equal(before, after);
  assert.equal(new URL(before).searchParams.get('id'), 'club-hamburg');
});

test('governed route keys and explicit suppression are authoritative', () => {
  assert.equal(pinkFinalClubRouteKey({ club_id: 'legacy-id', pink_final_club_route_key: 'public-id' }), 'public-id');
  assert.equal(pinkFinalClubPublicationState({ club_id: 'club-a', club_profile_status: 'private', pink_final_club_profile_url: 'https://example.test/clubs/?id=club-a' }), 'unpublished');
  assert.equal(pinkFinalClubProfileUrl({ club_id: 'club-a', club_profile_status: 'private', pink_final_club_profile_url: 'https://example.test/clubs/?id=club-a' }), null);
});

test('club identity projection exposes only public route metadata', () => {
  const projected = projectPinkFinalClubIdentity({
    club_id: 'club-a',
    world_id: 'private-world',
    appointment_id: 'private-appointment',
    manager_id: 'private-manager',
    players: ['private-player']
  });
  assert.deepEqual(Object.keys(projected).sort(), [
    'pink_final_club_profile_status',
    'pink_final_club_profile_url',
    'pink_final_club_route_key'
  ]);
  assert.equal(JSON.stringify(projected).includes('private-'), false);
});

test('public reverse links carry only the stable club identity', () => {
  const url = tbgClubEntryUrl({ club_id: 'club-a' }, { baseUrl: 'https://manager.example.test/private?old=value#state' });
  const parsed = new URL(url);
  assert.equal(parsed.search, '?club=club-a');
  assert.equal(parsed.hash, '');
  assert.equal(requestedTbgClubId(url), 'club-a');
  assert.equal(requestedTbgClubId('https://manager.example.test/?club=club-a&world_id=world-1'), null);
  assert.equal(requestedTbgClubId('https://manager.example.test/?club=../../secret'), null);
});

test('history remains authenticated and the UI uses the governed projected URL', async () => {
  const history = await readFile(new URL('../netlify/functions/history.mjs', import.meta.url), 'utf8');
  const inspection = await readFile(new URL('../public/club-inspection.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(history, /if \(!token\) return json\(\{ error: 'Authentication required' \}, 401\)/);
  assert.match(history, /'cache-control': 'no-store'/);
  assert.match(history, /projectPinkFinalClubIdentity/);
  assert.match(inspection, /club\.pink_final_club_profile_url/);
  assert.match(inspection, /View in The Pink Final/);
  assert.match(index, /stable-club-links\.js/);
});
