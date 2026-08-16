import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceIncrementalMatchday, createIncrementalSeason } from '../src/matchEngine/incrementalSeasonSimulation.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { archiveRowsForCanonicalWorld } from '../netlify/functions/refresh-match-archives.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));

function ratedSimulator(contract) {
  const homePlayer = contract.teams.home.starting_xi[0];
  const awayPlayer = contract.teams.away.starting_xi[0];
  const playerRatings = {
    home: [{ player_id: homePlayer, side: 'home', minutes_played: 90, role: 'goalkeeper', rating: 7.4 }],
    away: [{ player_id: awayPlayer, side: 'away', minutes_played: 90, role: 'goalkeeper', rating: 6.2 }]
  };
  return {
    result_version: '2d5-v1',
    run_key: contract.run_key,
    fixture_id: contract.fixture.fixture_id,
    status: 'completed',
    played_at: contract.fixture.kickoff_at,
    score: { home: 1, away: 0 },
    outcome: 'home_win',
    events: [],
    statistics: { home: {}, away: {} },
    player_ratings: playerRatings,
    player_of_the_match: playerRatings.home[0],
    report: { headline: 'Home win', summary: 'A rated match.', talking_points: [] },
    lineup_state: { home: { players_used: [...contract.teams.home.starting_xi] }, away: { players_used: [...contract.teams.away.starting_xi] } },
    state_changes: { fitness: [], injuries: [], discipline: [] },
    model: {
      simulator: 'tbg-constitutional-engine-a-g',
      adapter_version: 'test-adapter',
      performance_ratings_version: 'tbg-performance-ratings-v0.1'
    }
  };
}

test('active matchday runtime preserves Module G ratings and model metadata for Match Centre archives', () => {
  const clubs = clone(syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }));
  const runtime = createIncrementalSeason({
    clubs,
    seasonId: 'ratings-persistence-season',
    startAt: '2026-08-01T20:00:00.000Z',
    daysBetweenRounds: 7
  });

  advanceIncrementalMatchday(runtime, { clubs, simulator: ratedSimulator });

  assert.equal(runtime.results.length, 2);
  for (const result of runtime.results) {
    assert.equal(result.result_version, '2d5-v1');
    assert.equal(result.model?.performance_ratings_version, 'tbg-performance-ratings-v0.1');
    assert.ok(Array.isArray(result.player_ratings?.home));
    assert.ok(Array.isArray(result.player_ratings?.away));
    assert.equal(result.player_ratings.home[0].rating, 7.4);
    assert.equal(result.player_ratings.away[0].rating, 6.2);
    assert.equal(result.player_of_the_match?.rating, 7.4);
    assert.equal(result.report?.headline, 'Home win');
  }

  const worldRow = {
    world_id: 'tbg-world-test',
    season_id: runtime.season_id,
    matchday: 2,
    save_checksum: 'checksum-ratings',
    save_envelope: {
      world: {
        matchday_cycle: { season_id: runtime.season_id, runtimes: { d1: runtime } },
        squad_cycle: {
          clubs: Object.fromEntries(clubs.map((club) => [club.club_id, { player_ids: club.players.map((player) => player.tbg_player_id) }])),
          players: Object.fromEntries(clubs.flatMap((club) => club.players.map((player) => [player.tbg_player_id, player])))
        }
      }
    }
  };
  const archiveRows = archiveRowsForCanonicalWorld(worldRow);
  assert.equal(archiveRows.length, 2);
  for (const row of archiveRows) {
    assert.equal(row.archive_payload.result.model.performance_ratings_version, 'tbg-performance-ratings-v0.1');
    assert.equal(row.archive_payload.result.player_of_the_match.rating, 7.4);
    assert.equal(row.archive_payload.result.player_ratings.home[0].rating, 7.4);
  }
});
