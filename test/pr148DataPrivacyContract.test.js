import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PUBLIC_PLAYER_FIELDS,
  PUBLIC_CLUB_FIELDS,
  MANAGER_VISIBLE_LIVE_FIELDS,
  NEVER_PUBLIC_FIELDS,
  assertPublicProjection,
  projectPublicPlayer,
  projectPublicClub,
  projectPublicDirectory,
  projectManagerVisibleLiveState,
  publicProfileUrl,
  safeExplicitPublicProfileUrl
} from '../src/privacy/dataPrivacyContract.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public player projection is allow-listed and strips live-world state', () => {
  const player = projectPublicPlayer({
    tbg_player_id: 'player-1',
    display_name: 'Public Player',
    tbg_rating: 91,
    official_potential_band: '90–94',
    club_id: 'private-live-club',
    fitness: 72,
    morale: 38,
    contract: { wage: 100000 },
    manager_id: 'manager-1',
    unrevealed_results: [{ home: 4, away: 0 }]
  });

  assert.deepEqual(Object.keys(player).sort(), [
    'display_name', 'official_potential_band', 'tbg_player_id', 'tbg_rating'
  ]);
  assert.equal(JSON.stringify(player).includes('private-live-club'), false);
  assert.equal(PUBLIC_PLAYER_FIELDS.includes('fitness'), false);
  assert.equal(PUBLIC_PLAYER_FIELDS.includes('contract'), false);
});

test('public club projection cannot reveal appointments squads or competition state', () => {
  const club = projectPublicClub({
    club_id: 'club-1',
    canonical_name: 'Canonical FC',
    country: 'England',
    manager_id: 'manager-1',
    appointment_id: 'appointment-1',
    division_name: 'Division 1',
    league_position: 1,
    players: ['player-1'],
    pending_results: [{ score: '5-0' }]
  });

  assert.deepEqual(club, {
    club_id: 'club-1',
    canonical_name: 'Canonical FC',
    country: 'England'
  });
  assert.equal(PUBLIC_CLUB_FIELDS.includes('division_name'), false);
  assert.equal(PUBLIC_CLUB_FIELDS.includes('players'), false);
});

test('directory projection applies the same boundary to every record', () => {
  const projected = projectPublicDirectory({
    players: [{ tbg_player_id: 'p1', display_name: 'One', team_sheet: ['secret'] }],
    clubs: [{ club_id: 'c1', club_name: 'One FC', command_queue: ['secret'] }]
  });
  assert.deepEqual(projected, {
    players: [{ tbg_player_id: 'p1', display_name: 'One' }],
    clubs: [{ club_id: 'c1', club_name: 'One FC' }]
  });
});

test('public assertion rejects nested private fields even after composition', () => {
  for (const field of NEVER_PUBLIC_FIELDS) {
    assert.throws(
      () => assertPublicProjection({ public: { [field]: 'secret' } }),
      new RegExp(`Private field .*${field}`)
    );
  }
});

test('manager live projection is richer but remains an explicit allow-list', () => {
  const projected = projectManagerVisibleLiveState({
    club_id: 'club-1',
    fitness: 88,
    morale: 77,
    results: [{ revealed: true, score: '2-1' }],
    appointment_id: 'appointment-1',
    manager_commands: [{ type: 'select-team' }],
    simulation_seed: 'secret'
  });
  assert.deepEqual(projected, {
    club_id: 'club-1',
    fitness: 88,
    morale: 77,
    results: [{ revealed: true, score: '2-1' }]
  });
  assert.ok(MANAGER_VISIBLE_LIVE_FIELDS.includes('results'));
  assert.equal(MANAGER_VISIBLE_LIVE_FIELDS.includes('appointment_id'), false);
});

test('public profile URLs cannot carry hidden world scope', () => {
  assert.equal(
    publicProfileUrl('https://pink.example.test/players/?world_id=secret#private', 'player-1'),
    'https://pink.example.test/players/?id=player-1'
  );
  assert.equal(publicProfileUrl('https://pink.example.test/players/', '../../secret'), null);
  assert.equal(publicProfileUrl('javascript:alert(1)', 'player-1'), null);
  assert.equal(
    safeExplicitPublicProfileUrl('https://pink.example.test/players/?id=player-1', 'https://pink.example.test/'),
    'https://pink.example.test/players/?id=player-1'
  );
  assert.equal(
    safeExplicitPublicProfileUrl('https://pink.example.test/players/?id=player-1&appointment_id=secret', 'https://pink.example.test/'),
    null
  );
  assert.equal(safeExplicitPublicProfileUrl('https://user:pass@pink.example.test/player/1', 'https://pink.example.test/'), null);
});

test('canonical history remains bearer protected and non-cacheable', async () => {
  const history = await read('netlify/functions/history.mjs');
  assert.match(history, /if \(!token\) return json\(\{ error: 'Authentication required' \}, 401\)/);
  assert.match(history, /authorization/);
  assert.match(history, /'cache-control': 'no-store'/);
  assert.doesNotMatch(history, /access-control-allow-origin[^\n]*\*/i);
});

test('public reverse club route carries no appointment or world scope', async () => {
  const route = await read('public/stable-club-route.js');
  assert.match(route, /FORBIDDEN_SCOPE_KEYS/);
  assert.match(route, /'world_id'/);
  assert.match(route, /'appointment_id'/);
  assert.match(route, /url\.searchParams\.set\('club', clubId\)/);
});

test('written contract assigns repository and spoiler responsibilities', async () => {
  const contract = await read('docs/data-privacy-contract.md');
  assert.match(contract, /beautiful-game-data/);
  assert.match(contract, /beautiful-game-engine/);
  assert.match(contract, /beautiful-game-governance/);
  assert.match(contract, /pending, unrevealed or embargoed match results/i);
  assert.match(contract, /active appointment/i);
  assert.match(contract, /A convenient field is not automatically a public field/);
});
