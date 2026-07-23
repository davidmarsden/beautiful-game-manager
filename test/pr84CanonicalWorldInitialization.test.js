import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { buildCanonicalWorldFromPublication } from '../src/world/canonicalWorldInitialization.js';
import { validatePersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { loadPersistentWorld } from '../src/world/persistentSeasonLoop.js';

function publication({ clubsPerDivision = 10 } = {}) {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision });
  const players = [];
  const player_ownership = [];
  const clubs = divisions.flatMap((division) => division.clubs.map((club) => {
    for (const player of club.players) {
      players.push({ ...player });
      player_ownership.push({ tbg_player_id: player.tbg_player_id, club_id: club.club_id });
    }
    return {
      tbg_club_id: club.club_id,
      canonical_name: club.club_name,
      division_id: `division-${division.level}`,
      squad: { player_ids: club.players.map((player) => player.tbg_player_id) }
    };
  }));
  return { world_id: 'published-world', clubs, players, player_ownership };
}

test('builds a valid five-division canonical save from published data', () => {
  const source = publication();
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.summary.world_id, 'tbg-world-1');
  assert.equal(result.summary.division_count, 5);
  assert.equal(result.summary.club_count, 50);
  assert.equal(result.world.competition.movement_count_per_boundary, 4);
  assert.equal(validatePersistentLeagueWorld(result.world).valid, true);
  assert.deepEqual(loadPersistentWorld(JSON.stringify(result.envelope)), result.world);
});

test('uses authoritative ownership to prevent one player entering two clubs', () => {
  const source = publication();
  const first = source.clubs[0];
  const second = source.clubs[1];
  const borrowed = first.squad.player_ids[0];
  second.squad.player_ids.push(borrowed);
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: first.tbg_club_id
  });
  assert.equal(result.world.squad_cycle.players[borrowed].club_id, first.tbg_club_id);
  assert.equal(result.world.squad_cycle.clubs[second.tbg_club_id].player_ids.includes(borrowed), false);
});

test('fails safely when a published division cannot field playable clubs', () => {
  const source = publication();
  source.clubs = source.clubs.filter((club) => club.division_id !== 'division-5');
  assert.throws(() => buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id
  }), /Division 5/);
});

test('rejects a division too small for configured promotion and relegation', () => {
  const source = publication({ clubsPerDivision: 8 });
  assert.throws(() => buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    movementCount: 4
  }), /needs more than 8 clubs for 4-up\/4-down/);
});

test('persists the configured registration limit in the canonical save', () => {
  const source = publication();
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    registrationLimit: 20,
    movementCount: 4
  });
  assert.equal(result.world.squad_cycle.registration_limit, 20);
  assert.equal(loadPersistentWorld(JSON.stringify(result.envelope)).squad_cycle.registration_limit, 20);
  assert.ok(Object.values(result.world.squad_cycle.clubs).every((club) => club.registered_player_ids.length <= 20));
});
