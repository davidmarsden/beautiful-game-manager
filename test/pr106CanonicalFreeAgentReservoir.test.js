import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalFreeAgentCandidates, canonicalFreeAgentReservoirFingerprint, importCanonicalFreeAgentReservoir } from '../src/world/canonicalFreeAgentReservoir.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function publication() {
  return {
    world_id: 'published-world',
    clubs: [
      { club_id: 'club-a', player_ids: ['owned-in-squad'] },
      { club_id: 'club-b', squad: { player_ids: ['other-squad-player'] } }
    ],
    players: [
      { tbg_player_id: 'owned-in-squad', name: 'Owned One', position: 'GK', age: 26, rating: 82 },
      { tbg_player_id: 'other-squad-player', name: 'Owned Two', position: 'CB', age: 25, rating: 80 },
      { tbg_player_id: 'owned-off-list', name: 'Owned Three', position: 'CM', age: 24, rating: 79 },
      { tbg_player_id: 'free-gk', name: 'Free Keeper', position: 'GK', age: 28, rating: 77 },
      { tbg_player_id: 'free-mid', name: 'Free Midfielder', position_detail: 'Central Midfield', age: 23, rating: 76 }
    ],
    player_ownership: [
      { player_id: 'owned-in-squad', club_id: 'club-a' },
      { player_id: 'other-squad-player', club_id: 'club-b' },
      { player_id: 'owned-off-list', club_id: 'club-c' },
      { player_id: 'free-gk', club_id: null },
      { player_id: 'free-mid', club_id: null }
    ]
  };
}

test('reservoir contains only genuinely unattached publication players', () => {
  const candidates = canonicalFreeAgentCandidates(publication());
  assert.deepEqual(candidates.map((row) => row.player.tbg_player_id), ['free-gk', 'free-mid']);
  assert.ok(candidates.every((row) => row.player.club_id === null));
  assert.ok(candidates.every((row) => row.player.contract_id === null));
});

test('reservoir import preserves stable IDs and does not duplicate canonical players', () => {
  const world = {
    squad_cycle: {
      players: { 'free-gk': { tbg_player_id: 'free-gk', club_id: null } },
      registrations: { 'free-gk': { player_id: 'free-gk', club_id: null, registered: false } }
    }
  };
  const result = importCanonicalFreeAgentReservoir(world, publication());
  assert.equal(result.imported_count, 1);
  assert.deepEqual(result.imported_player_ids, ['free-mid']);
  assert.equal(world.squad_cycle.players['free-mid'].display_name, 'Free Midfielder');
  assert.deepEqual(world.squad_cycle.registrations['free-mid'], {
    player_id: 'free-mid', club_id: null, registered: false, registered_at: null
  });
});

test('reservoir fingerprint changes when any plan-affecting candidate field changes', () => {
  const original = publication();
  const baseline = canonicalFreeAgentReservoirFingerprint(original);
  for (const mutate of [
    (copy) => { copy.players[3].position = 'CB'; },
    (copy) => { copy.players[3].rating = 91; },
    (copy) => { copy.players[3].age = 19; },
    (copy) => { copy.players[3].name = 'Renamed Keeper'; },
    (copy) => { copy.players.reverse(); }
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(canonicalFreeAgentReservoirFingerprint(changed), baseline);
  }
});

test('future canonical initialization persists the publication reservoir', async () => {
  const initializer = await source('src/world/canonicalWorldInitialization.js');
  assert.match(initializer, /importCanonicalFreeAgentReservoir\(world, publicationWorld\)/);
  assert.match(initializer, /free_agent_reservoir_count/);
});

test('live repair imports reservoir before planning and pins apply to its fingerprint', async () => {
  const [endpoint, control] = await Promise.all([
    source('netlify/functions/repair-canonical-registrations.mjs'),
    source('public/admin-turn-control.js')
  ]);
  assert.match(endpoint, /fetchPublicationWorld\(\)/);
  assert.match(endpoint, /canonicalFreeAgentReservoirFingerprint\(publication, \{ existingPlayerIds \}\)/);
  assert.match(endpoint, /importCanonicalFreeAgentReservoir\(world, publication\)/);
  assert.match(endpoint, /expected_reservoir_fingerprint !== fingerprint/);
  assert.match(endpoint, /Published free-agent reservoir changed after preview/);
  assert.match(endpoint, /reservoir_imported/);
  assert.match(control, /expected_reservoir_fingerprint/);
  assert.match(control, /reservoir_fingerprint/);
  assert.match(control, /unattached players imported into the preview reservoir/);
});
