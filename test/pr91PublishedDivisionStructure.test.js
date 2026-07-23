import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { buildCanonicalWorldFromPublication } from '../src/world/canonicalWorldInitialization.js';
import { createPersistentLeagueWorld, runPersistentLeagueSeasons, validatePersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';

function publicationWithDivisions(divisionCount, clubsPerDivision = 10) {
  const sourceDivisions = syntheticPlayableLeagueStructure({ clubsPerDivision }).slice(0, divisionCount);
  const players = [];
  const player_ownership = [];
  const clubs = sourceDivisions.flatMap((division, index) => division.clubs.map((club) => {
    for (const player of club.players) {
      players.push({ ...player });
      player_ownership.push({ tbg_player_id: player.tbg_player_id, club_id: club.club_id });
    }
    return {
      tbg_club_id: club.club_id,
      canonical_name: club.club_name,
      division_id: `division-${index + 1}`,
      squad: { player_ids: club.players.map((player) => player.tbg_player_id) }
    };
  }));
  const divisions = sourceDivisions.map((division, index) => ({
    division_id: `division-${index + 1}`,
    level: index + 1,
    club_ids: division.clubs.map((club) => club.club_id)
  }));
  return { world_id: `published-${divisionCount}`, clubs, players, player_ownership, divisions };
}

test('canonical initialization follows the published four-division structure', () => {
  const publication = publicationWithDivisions(4);
  const result = buildCanonicalWorldFromPublication(publication, {
    worldId: 'four-division-world',
    humanClubId: publication.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.summary.division_count, 4);
  assert.equal(result.summary.club_count, 40);
  assert.deepEqual(result.world.competition.divisions.map((division) => division.division_id), ['d1', 'd2', 'd3', 'd4']);
  assert.equal(validatePersistentLeagueWorld(result.world).valid, true);
});

test('four-division persistent world completes rollover across three boundaries', () => {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 10 }).slice(0, 4)
    .map((division, index) => ({ ...division, division_id: `d${index + 1}`, level: index + 1 }));
  const world = createPersistentLeagueWorld({
    worldId: 'four-division-rollover',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 4
  });
  const report = runPersistentLeagueSeasons({ seasons: 1, world });
  assert.equal(report.accepted, true);
  assert.equal(report.reports[0].archives.length, 4);
  assert.equal(report.reports[0].movements.length, 24);
  assert.equal(report.final_world.competition.divisions.length, 4);
});

test('five-division support remains available when publication contains five', () => {
  const publication = publicationWithDivisions(5);
  const result = buildCanonicalWorldFromPublication(publication, {
    worldId: 'five-division-world',
    humanClubId: publication.clubs[0].tbg_club_id,
    movementCount: 4
  });
  assert.equal(result.summary.division_count, 5);
  assert.deepEqual(result.world.competition.divisions.map((division) => division.division_id), ['d1', 'd2', 'd3', 'd4', 'd5']);
});
