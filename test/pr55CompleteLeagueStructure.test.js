import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYABLE_DIVISION_COUNT,
  simulateCompleteLeagueStructure,
  syntheticPlayableLeagueStructure
} from '../src/matchEngine/leagueStructureSimulation.js';

test('synthetic playable structure creates five descending, globally unique divisions', () => {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  assert.equal(divisions.length, DEFAULT_PLAYABLE_DIVISION_COUNT);
  assert.deepEqual(divisions.map((division) => division.division_id), ['d1', 'd2', 'd3', 'd4', 'd5']);
  assert.ok(divisions.slice(1).every((division, index) => divisions[index].average_starting_rating > division.average_starting_rating));

  const clubIds = divisions.flatMap((division) => division.clubs.map((club) => club.club_id));
  const playerIds = divisions.flatMap((division) => division.clubs.flatMap((club) => club.players.map((player) => player.tbg_player_id)));
  assert.equal(new Set(clubIds).size, clubIds.length);
  assert.equal(new Set(playerIds).size, playerIds.length);
});

test('all playable divisions complete and reconcile in one autonomous league run', () => {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  const report = simulateCompleteLeagueStructure({
    divisions,
    seasonId: 'pr55-complete-league',
    startAt: '2026-08-01T15:00:00.000Z'
  });

  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.division_count, 5);
  assert.equal(report.club_count, 20);
  assert.equal(report.fixture_count, 60);
  assert.ok(report.metrics.total_goals > 0);
  assert.ok(report.metrics.unique_public_event_ids > 0);

  for (const division of report.divisions) {
    assert.equal(division.accepted, true, `${division.division_id} failed its season checks`);
    assert.equal(division.fixture_count, 12);
    assert.equal(division.standings.length, 4);
    assert.ok(division.standings.every((row) => row.played === 6));
    assert.equal(division.standings.reduce((sum, row) => sum + row.gf, 0), division.standings.reduce((sum, row) => sum + row.ga, 0));
  }
});

test('complete league structure is deterministic for the same season inputs', () => {
  const divisions = syntheticPlayableLeagueStructure({ divisionCount: 2, clubsPerDivision: 4 });
  const options = { divisions, seasonId: 'pr55-repeatable', startAt: '2026-08-01T15:00:00.000Z' };
  const first = simulateCompleteLeagueStructure(options);
  const second = simulateCompleteLeagueStructure(options);

  assert.deepEqual(
    first.divisions.map((division) => division.standings),
    second.divisions.map((division) => division.standings)
  );
  assert.deepEqual(first.metrics, second.metrics);
  assert.deepEqual(first.checks, second.checks);
});
