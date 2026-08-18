import test from 'node:test';
import assert from 'node:assert/strict';
import { projectManagerPortal } from '../src/world/managerPortalProjection.js';
import { validateManagerSelectionEligibility } from '../src/world/sharedWorldScheduler.js';

function worldFixture() {
  return {
    world_id: 'world-1',
    display_name: 'Test World',
    season_number: 1,
    phase: 'season',
    club_profiles: {
      'club-1': { club_name: 'Club One', short_name: 'Club One' }
    },
    competition: {
      divisions: [{ division_id: 'd1', level: 1, club_ids: ['club-1'] }]
    },
    squad_cycle: {
      season_id: 'season-1',
      registration_limit: 25,
      clubs: {
        'club-1': {
          club_id: 'club-1',
          player_ids: ['senior-1', 'youth-1', 'academy-1', 'adult-unregistered'],
          registered_player_ids: ['senior-1']
        }
      },
      players: {
        'senior-1': {
          tbg_player_id: 'senior-1',
          display_name: 'Senior Player',
          club_id: 'club-1',
          age: 27,
          registered: true,
          position: 'CM'
        },
        'youth-1': {
          tbg_player_id: 'youth-1',
          display_name: 'Youth Player',
          club_id: 'club-1',
          age: 20,
          registered: true,
          position: 'GK'
        },
        'academy-1': {
          tbg_player_id: 'academy-1',
          display_name: 'Academy Marker Player',
          club_id: 'club-1',
          age: 23,
          registered: true,
          squad_registration: 'academy',
          position: 'CB'
        },
        'adult-unregistered': {
          tbg_player_id: 'adult-unregistered',
          display_name: 'Unregistered Adult',
          club_id: 'club-1',
          age: 28,
          registered: false,
          position: 'CF'
        }
      },
      contracts: {}
    },
    matchday_cycle: {
      current_matchday: 1,
      maximum_matchday: 1,
      runtimes: {
        d1: { fixtures: [], results: [], archive_results: [], table: {}, state: {} }
      }
    }
  };
}

test('youth-exempt players are not projected as unregistered merely because they are absent from the senior registration list', () => {
  const portal = projectManagerPortal(worldFixture(), 'club-1');
  const senior = portal.squad.find((player) => player.tbg_player_id === 'senior-1');
  const youth = portal.squad.find((player) => player.tbg_player_id === 'youth-1');
  const academy = portal.squad.find((player) => player.tbg_player_id === 'academy-1');

  assert.equal(senior.registered, true);
  assert.equal(senior.registration_status, 'registered');
  assert.equal(youth.youth_eligible_at_season_start, true);
  assert.equal(youth.registered, true);
  assert.equal(youth.registration_status, 'youth_exempt');
  assert.equal(academy.youth_eligible_at_season_start, true);
  assert.equal(academy.registration_status, 'youth_exempt');
});

test('authoritative submission eligibility honours the same youth exemption as the portal', () => {
  const world = worldFixture();
  const eligible = validateManagerSelectionEligibility(world, 'club-1', {
    starting_xi: ['senior-1', 'youth-1', 'academy-1']
  });
  assert.equal(eligible.valid, true);
  assert.deepEqual(eligible.invalid_player_ids, []);

  const adult = validateManagerSelectionEligibility(world, 'club-1', {
    starting_xi: ['adult-unregistered']
  });
  assert.equal(adult.valid, false);
  assert.deepEqual(adult.invalid_player_ids, ['adult-unregistered']);
  assert.match(adult.errors[0], /not registered for competitive selection/);
});
