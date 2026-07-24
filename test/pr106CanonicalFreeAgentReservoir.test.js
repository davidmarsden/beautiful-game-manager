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

test('legacy reservoir import preserves stable IDs and does not duplicate canonical players', () => {
  const world = { squad_cycle: { players: { 'free-gk': { tbg_player_id: 'free-gk', club_id: null } }, registrations: { 'free-gk': { player_id: 'free-gk', club_id: null, registered: false } } } };
  const result = importCanonicalFreeAgentReservoir(world, publication());
  assert.equal(result.imported_count, 1);
  assert.deepEqual(result.imported_player_ids, ['free-mid']);
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

test('future canonical initialization uses the external catalogue and persists only selected signings', async () => {
  const initializer = await source('src/world/canonicalWorldInitialization.js');
  assert.match(initializer, /canonicalFreeAgentCandidates\(publicationWorld/);
  assert.match(initializer, /planCanonicalRegistrationRepair\(projectedWorld/);
  assert.match(initializer, /free_agent_signing_count/);
  assert.doesNotMatch(initializer, /importCanonicalFreeAgentReservoir\(world, publicationWorld\)/);
});

test('live repair keeps candidates external until planning and pins apply to its fingerprint', async () => {
  const [endpoint, control] = await Promise.all([
    source('netlify/functions/repair-canonical-registrations.mjs'),
    source('public/admin-turn-control.js')
  ]);
  assert.match(endpoint, /canonicalFreeAgentCandidates\(publication, \{ existingPlayerIds \}\)/);
  assert.match(endpoint, /freeAgentCandidates: candidates/);
  assert.doesNotMatch(endpoint, /importCanonicalFreeAgentReservoir\(world, publication\)/);
  assert.match(endpoint, /expected_reservoir_fingerprint !== fingerprint/);
  assert.match(endpoint, /reservoir_materialised_in_checkpoint/);
  assert.match(control, /only .* selected signings would be added to the canonical checkpoint/);
  assert.match(control, /total registrations before/);
});
