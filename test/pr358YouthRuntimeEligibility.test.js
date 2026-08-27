import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { availabilityForPlayer } from '../src/matchEngine/squadAvailability.js';
import { advancePersistentMatchday, reconcileCrossDivisionRuntimePlayerState } from '../src/world/persistentMatchdayWorld.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { competitiveRegistration } from '../src/world/registrationEligibility.js';
import { validateManagerSelectionEligibility } from '../src/world/sharedWorldScheduler.js';

const available = () => ({
  injury_until_matchday: 0,
  suspension_until_matchday: 0,
  injury_reason: null,
  suspension_reason: null
});

function fixtureWorld() {
  const registeredSenior = 'senior-registered';
  const unregisteredSenior = 'senior-unregistered';
  const youth = 'tbg-tm-01193849';
  const clubId = 'tbg-club-014';
  const club = {
    club_id: clubId,
    player_ids: [registeredSenior, unregisteredSenior, youth],
    registered_player_ids: [registeredSenior]
  };
  const players = {
    [registeredSenior]: { tbg_player_id: registeredSenior, club_id: clubId, age: 28, status: 'active', contract_id: `contract-${registeredSenior}` },
    [unregisteredSenior]: { tbg_player_id: unregisteredSenior, club_id: clubId, age: 29, status: 'active', contract_id: `contract-${unregisteredSenior}` },
    [youth]: { tbg_player_id: youth, club_id: clubId, age: 17, status: 'active', contract_id: `contract-${youth}` }
  };
  const contracts = Object.fromEntries(Object.values(players).map((player) => [player.contract_id, {
    contract_id: player.contract_id,
    player_id: player.tbg_player_id,
    club_id: clubId,
    status: 'active'
  }]));
  return {
    world_id: 'tbg-world-1',
    competition: { divisions: [{ division_id: 'd1', club_ids: [clubId] }] },
    squad_cycle: { clubs: { [clubId]: club }, players, contracts },
    matchday_cycle: {
      current_matchday: 11,
      runtimes: {
        d1: {
          state: {
            availability: {
              players: {
                [registeredSenior]: available(),
                [unregisteredSenior]: available()
              }
            }
          }
        }
      }
    }
  };
}

function persistentWorldWithYouthExemption() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  const clubId = divisions[0].clubs[0].club_id;
  const world = createPersistentLeagueWorld({
    worldId: 'pr358-runtime-world',
    divisions,
    humanClubId: clubId,
    movementCount: 1
  });
  const club = world.squad_cycle.clubs[clubId];
  const youth = club.registered_player_ids.at(-1);
  club.registered_player_ids = club.registered_player_ids.filter((playerId) => playerId !== youth);
  world.squad_cycle.players[youth].age = 17;
  world.squad_cycle.players[youth].season_start_age = 17;
  world.squad_cycle.players[youth].youth_eligible_at_season_start = true;
  return { world, clubId, youth };
}

function runtimeForClub(world, clubId) {
  const division = world.competition.divisions.find((row) => row.club_ids.includes(clubId));
  return world.matchday_cycle.runtimes[division.division_id];
}

test('#358 competitive registration includes youth-exempt players but excludes unregistered seniors', () => {
  const world = fixtureWorld();
  const club = world.squad_cycle.clubs['tbg-club-014'];

  assert.equal(competitiveRegistration(world, club, 'senior-registered').registered, true);
  assert.equal(competitiveRegistration(world, club, 'senior-unregistered').registered, false);
  assert.deepEqual(competitiveRegistration(world, club, 'tbg-tm-01193849'), {
    registered: true,
    status: 'youth_exempt',
    youth_exempt: true
  });
});

test('#358 persistent matchday initialization includes youth-exempt players outside explicit registration', () => {
  const { world, clubId, youth } = persistentWorldWithYouthExemption();
  assert.equal(world.squad_cycle.clubs[clubId].registered_player_ids.includes(youth), false);
  assert.equal(competitiveRegistration(world, world.squad_cycle.clubs[clubId], youth).registered, true);

  const report = advancePersistentMatchday(world);
  assert.equal(report.accepted, true);
  const runtime = runtimeForClub(report.world, clubId);
  assert.ok(runtime.state.players[youth]);
  assert.ok(runtime.state.availability.players[youth]);
});

test('#358 stale runtime availability does not turn a canonical youth player into unknown_player', () => {
  const world = fixtureWorld();

  const youth = validateManagerSelectionEligibility(world, 'tbg-club-014', {
    starting_xi: ['tbg-tm-01193849']
  });
  assert.equal(youth.valid, true);
  assert.deepEqual(youth.errors, []);

  const unregisteredSenior = validateManagerSelectionEligibility(world, 'tbg-club-014', {
    starting_xi: ['senior-unregistered']
  });
  assert.equal(unregisteredSenior.valid, false);
  assert.match(unregisteredSenior.errors.join('; '), /not registered for competitive selection/);

  const unknown = validateManagerSelectionEligibility(world, 'tbg-club-014', {
    starting_xi: ['not-a-player']
  });
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors.join('; '), /not owned by the submitted club/);
});

test('#358 runtime reconciliation initializes missing eligible player state without erasing known absences', () => {
  const youth = 'tbg-tm-01193849';
  const cycle = {
    runtimes: {
      d1: {
        state: {
          players: {},
          availability: { players: {} }
        }
      }
    }
  };
  const clubsByDivision = {
    d1: [{ club_id: 'tbg-club-014', players: [{ tbg_player_id: youth }] }]
  };

  reconcileCrossDivisionRuntimePlayerState(cycle, clubsByDivision);

  assert.deepEqual(cycle.runtimes.d1.state.players[youth], {
    fitness: 100,
    sharpness: 100,
    morale: 50
  });
  assert.equal(availabilityForPlayer(cycle.runtimes.d1.state.availability, youth, 11).available, true);

  cycle.runtimes.d1.state.availability.players[youth] = {
    injury_until_matchday: 12,
    suspension_until_matchday: 0,
    injury_reason: 'hamstring',
    suspension_reason: null
  };
  reconcileCrossDivisionRuntimePlayerState(cycle, clubsByDivision);
  assert.equal(availabilityForPlayer(cycle.runtimes.d1.state.availability, youth, 11).reason, 'injured');
});

test('#358 known runtime injury remains a hard selection failure', () => {
  const world = fixtureWorld();
  world.matchday_cycle.runtimes.d1.state.availability.players['tbg-tm-01193849'] = {
    injury_until_matchday: 12,
    suspension_until_matchday: 0,
    injury_reason: 'hamstring',
    suspension_reason: null
  };

  const result = validateManagerSelectionEligibility(world, 'tbg-club-014', {
    starting_xi: ['tbg-tm-01193849']
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /is injured for matchday 11/);
});
