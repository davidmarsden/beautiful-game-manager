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

test('discovers Division Five from textual and nested publication fields', () => {
  const source = publication();
  const divisionFive = source.clubs.filter((club) => club.division_id === 'division-5');
  divisionFive.forEach((club, index) => {
    delete club.division_id;
    if (index < 5) club.division_name = 'Division Five';
    else club.competition = { division: '5th Division' };
  });
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.world.competition.divisions.find((division) => division.level === 5).club_ids.length, 10);
});

test('discovers clubs from a publication-level divisions membership ledger', () => {
  const source = publication();
  const divisionFive = source.clubs.filter((club) => club.division_id === 'division-5');
  source.divisions = [{ division_id: 'd5', club_ids: divisionFive.map((club) => club.tbg_club_id) }];
  divisionFive.forEach((club) => { delete club.division_id; });
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.world.competition.divisions.find((division) => division.level === 5).club_ids.length, 10);
});

test('scans later division ledgers when the first candidate is empty', () => {
  const source = publication();
  const divisionFive = source.clubs.filter((club) => club.division_id === 'division-5');
  source.divisions = [];
  source.league_structure = {
    divisions: [{ division_id: 'division-v', members: divisionFive.map((club) => ({ club_id: club.tbg_club_id })) }]
  };
  divisionFive.forEach((club) => { delete club.division_id; });
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.world.competition.divisions.find((division) => division.level === 5).club_ids.length, 10);
});

test('preserves numeric primitive squad player references', () => {
  const source = publication();
  const club = source.clubs[0];
  club.squad.player_ids.forEach((oldId, index) => {
    const numericId = 9000000 + index;
    const player = source.players.find((row) => row.tbg_player_id === oldId);
    const ownership = source.player_ownership.find((row) => row.tbg_player_id === oldId);
    player.tbg_player_id = numericId;
    ownership.tbg_player_id = numericId;
    club.squad.player_ids[index] = numericId;
  });
  const result = buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: club.tbg_club_id,
    movementCount: 4
  });
  const projected = result.world.squad_cycle.clubs[club.tbg_club_id];
  assert.equal(projected.player_ids.length >= 18, true);
  assert.equal(projected.player_ids.includes('9000000'), true);
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

test('rejects a non-contiguous published division set', () => {
  const source = publication();
  source.clubs = source.clubs.filter((club) => club.division_id !== 'division-4');
  assert.throws(() => buildCanonicalWorldFromPublication(source, {
    worldId: 'tbg-world-1',
    humanClubId: source.clubs[0].tbg_club_id
  }), /Published divisions must be contiguous from Division 1; found 1, 2, 3, 5/);
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
