import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceIncrementalMatchday, createIncrementalSeason } from '../src/matchEngine/incrementalSeasonSimulation.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { availabilityForPlayer } from '../src/matchEngine/squadAvailability.js';
import { reconcileCrossDivisionRuntimePlayerState } from '../src/world/persistentMatchdayWorld.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function inertSimulator(contract) {
  return {
    run_key: contract.run_key,
    status: 'completed',
    score: { home: 0, away: 0 },
    outcome: 'draw',
    events: [],
    statistics: { home: {}, away: {} },
    lineup_state: {},
    state_changes: { fitness: [], injuries: [], discipline: [] }
  };
}

test('mid-season registrations are reconciled into runtime fitness and availability before the next matchday', () => {
  const clubs = clone(syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }));
  const runtime = createIncrementalSeason({
    clubs,
    seasonId: 'midseason-registration',
    startAt: '2026-08-01T20:00:00.000Z',
    daysBetweenRounds: 7
  });

  advanceIncrementalMatchday(runtime, { clubs, simulator: inertSimulator });

  const club = clubs[0];
  const player = {
    tbg_player_id: `${club.club_id}-midseason-signing`,
    display_name: 'Mid-season Signing',
    position: 'Central Midfield',
    underlying_ability_rating: 90,
    work_rate: 65
  };
  club.players.push(player);

  assert.equal(runtime.state.players[player.tbg_player_id], undefined, 'legacy runtime has no fitness state for a newly registered player yet');
  assert.equal(availabilityForPlayer(runtime.state.availability, player.tbg_player_id, 2).reason, 'unknown_player');

  const startingXi = [...club.players.slice(0, 10).map((row) => row.tbg_player_id), player.tbg_player_id];
  assert.doesNotThrow(() => advanceIncrementalMatchday(runtime, {
    clubs,
    simulator: inertSimulator,
    instructionsByClub: {
      [club.club_id]: { starting_xi: startingXi }
    },
    instructionSourcesByClub: {
      [club.club_id]: { type: 'manager_submission', manager_id: 'manager-1', submission_id: 'submission-1' }
    }
  }));

  assert.deepEqual(runtime.state.players[player.tbg_player_id], {
    fitness: 100,
    sharpness: 100,
    morale: 50
  });
  assert.equal(availabilityForPlayer(runtime.state.availability, player.tbg_player_id, 3).available, true);
  const matchdayTwo = runtime.results.filter((row) => row.fixture.matchday === 2);
  const appearance = matchdayTwo.find((row) =>
    row.teams.home.starting_xi.includes(player.tbg_player_id)
      || row.teams.away.starting_xi.includes(player.tbg_player_id)
  );
  assert.ok(appearance, 'the newly registered player can be selected immediately after runtime reconciliation');
});

test('cross-division transfers inherit existing fitness and availability rather than resetting the player', () => {
  const playerId = 'player-cross-division';
  const sourcePlayerState = { fitness: 25, sharpness: 72, morale: 44 };
  const sourceAvailability = {
    injury_until_matchday: 4,
    suspension_until_matchday: 0,
    injury_reason: 'hamstring',
    suspension_reason: null
  };
  const cycle = {
    runtimes: {
      d1: {
        state: {
          players: {},
          availability: { players: {} }
        }
      },
      d2: {
        state: {
          players: { [playerId]: clone(sourcePlayerState) },
          availability: { players: { [playerId]: clone(sourceAvailability) } }
        }
      }
    }
  };
  const clubsByDivision = {
    d1: [{ club_id: 'd1-club', players: [{ tbg_player_id: playerId }] }],
    d2: [{ club_id: 'd2-club', players: [] }]
  };

  reconcileCrossDivisionRuntimePlayerState(cycle, clubsByDivision);

  assert.deepEqual(cycle.runtimes.d1.state.players[playerId], sourcePlayerState);
  assert.deepEqual(cycle.runtimes.d1.state.availability.players[playerId], sourceAvailability);
  assert.equal(availabilityForPlayer(cycle.runtimes.d1.state.availability, playerId, 2).available, false);
  assert.equal(availabilityForPlayer(cycle.runtimes.d1.state.availability, playerId, 2).reason, 'injured');
});
