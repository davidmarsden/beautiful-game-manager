import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { planCanonicalRegistrationRepair } from '../src/world/viableCanonicalRegistration.js';

function player(id, position, rating = 80) {
  return { tbg_player_id: id, display_name: id, position, age: 24, underlying_ability_rating: rating, registered: true };
}

function club(id, shortGoalkeeper = false) {
  const players = [
    ...Array.from({ length: shortGoalkeeper ? 1 : 2 }, (_, index) => player(`${id}-gk-${index + 1}`, 'GK', 70 - index)),
    ...Array.from({ length: 6 }, (_, index) => player(`${id}-def-${index + 1}`, 'CB', 90 - index)),
    ...Array.from({ length: 5 }, (_, index) => player(`${id}-mid-${index + 1}`, 'CM', 88 - index)),
    ...Array.from({ length: shortGoalkeeper ? 6 : 5 }, (_, index) => player(`${id}-att-${index + 1}`, 'CF', 86 - index))
  ];
  return { club_id: id, club_name: id, formation: '4-3-3-wide', players };
}

function world() {
  const divisions = [1, 2].map((level) => ({
    division_id: `d${level}`,
    level,
    clubs: Array.from({ length: 4 }, (_, index) => club(`d${level}-club-${index + 1}`, level === 1 && index === 0))
  }));
  return createPersistentLeagueWorld({
    worldId: 'selective-materialisation-test',
    divisions,
    humanClubId: 'd1-club-1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    movementCount: 1
  });
}

test('repair considers a large external catalogue but persists only selected signings', () => {
  const candidates = [
    { source_index: 0, player: { tbg_player_id: 'external-gk', display_name: 'External Keeper', position: 'GK', age: 27, underlying_ability_rating: 79, club_id: null, contract_id: null } },
    ...Array.from({ length: 99 }, (_, index) => ({
      source_index: index + 1,
      player: { tbg_player_id: `external-att-${index + 1}`, display_name: `External ${index + 1}`, position: 'CF', age: 24, underlying_ability_rating: 60 - (index / 100), club_id: null, contract_id: null }
    }))
  ];

  const result = planCanonicalRegistrationRepair(world(), { freeAgentCandidates: candidates });
  assert.equal(result.preview.accepted, true);
  assert.equal(result.preview.external_free_agents_considered, 100);
  assert.equal(result.preview.external_free_agents_materialised, 1);
  assert.ok(result.world.squad_cycle.players['external-gk']);
  assert.equal(result.world.squad_cycle.players['external-att-1'], undefined);
  assert.equal(Object.values(result.world.squad_cycle.players).filter((row) => row.canonical_status === 'free_agent').length, 0);
});

test('preview reconciles registrations before and after', () => {
  const result = planCanonicalRegistrationRepair(world(), {
    freeAgentCandidates: [{ source_index: 0, player: { tbg_player_id: 'external-gk', display_name: 'External Keeper', position: 'GK', age: 27, underlying_ability_rating: 79, club_id: null, contract_id: null } }]
  });
  assert.equal(result.preview.registered_after - result.preview.registered_before, result.preview.net_registration_change);
  for (const clubRow of result.preview.clubs) {
    assert.equal(clubRow.final_registered - clubRow.registered_before, clubRow.registration_delta);
  }
});
