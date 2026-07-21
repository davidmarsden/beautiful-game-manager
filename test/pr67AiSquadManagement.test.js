import test from 'node:test';
import assert from 'node:assert/strict';
import { createSquadCycleState, unregisterPlayer } from '../src/squadCycle/squadCycle.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { executeAiSquadPlan, manageWorldSquads, planAiSquad } from '../src/intelligence/aiSquadManagement.js';

function stateWithFreeAgents() {
  const state = createSquadCycleState({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'pr67-ai-squad',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z'
  });

  const freeAgentRows = [
    ['free-gk', 'GK', 82],
    ['free-cb', 'CB', 84],
    ['free-rb', 'RB', 83],
    ['free-dm', 'DM', 83],
    ['free-cm', 'CM', 82],
    ['free-cf', 'CF', 84],
    ['free-rw', 'RW', 81],
    ['free-lb', 'LB', 80]
  ];
  for (const [id, position, rating] of freeAgentRows) {
    state.players[id] = {
      tbg_player_id: id,
      display_name: id,
      club_id: null,
      age: 25,
      position,
      underlying_ability_rating: rating,
      contract_id: null
    };
  }
  return state;
}

const at = '2026-07-01T12:00:00.000Z';

test('plans deterministically from squad intelligence without mutating state', () => {
  const state = stateWithFreeAgents();
  const defenderIds = state.clubs['club-1'].registered_player_ids
    .filter((id) => ['Right-Back', 'Centre-Back', 'Left-Back'].includes(state.players[id].position))
    .slice(0, 2);
  for (const id of defenderIds) unregisterPlayer(state, { clubId: 'club-1', playerId: id, at, reason: 'test_gap' });

  const before = JSON.stringify(state);
  const first = planAiSquad(state, { clubId: 'club-1', at });
  const second = planAiSquad(state, { clubId: 'club-1', at });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(state), before);
  assert.ok(first.actions.some((row) => row.action === 'register' || row.action === 'sign_free_agent'));
});

test('repairs hard-minimum and positional gaps using owned players then free agents', () => {
  const state = stateWithFreeAgents();
  const removals = state.clubs['club-1'].registered_player_ids
    .filter((id) => ['Right-Back', 'Centre-Back', 'Left-Back'].includes(state.players[id].position))
    .slice(0, 3);
  for (const id of removals) unregisterPlayer(state, { clubId: 'club-1', playerId: id, at, reason: 'test_gap' });

  const result = executeAiSquadPlan(state, { clubId: 'club-1', at });

  assert.equal(result.accepted, true);
  assert.equal(result.after.summary.hard_minimum_gap, 0);
  assert.equal(result.after.coverage.find((row) => row.group === 'defender').registered_gap, 0);
  assert.ok(result.actions.some((row) => row.action === 'sign_free_agent'));
  assert.ok(state.events.some((row) => row.type === 'ai_squad_decision_applied'));
});

test('renews expiring non-surplus players before expiry', () => {
  const state = stateWithFreeAgents();
  const result = executeAiSquadPlan(state, { clubId: 'club-2', at });
  const renewals = result.actions.filter((row) => row.action === 'renew');

  assert.ok(renewals.length > 0);
  for (const row of renewals) {
    const player = state.players[row.player_id];
    assert.equal(state.contracts[player.contract_id].status, 'active');
    assert.ok(new Date(state.contracts[player.contract_id].end_at) > new Date(state.calendar.season_end));
  }
});

test('promotes the best ready youth prospect when a registration place exists', () => {
  const state = stateWithFreeAgents();
  state.players['club-1-ready-youth'] = {
    tbg_player_id: 'club-1-ready-youth', display_name: 'Ready Youth', club_id: 'club-1', age: 18,
    position: 'CM', underlying_ability_rating: 70, youth_intake_season: state.season_id,
    contract_id: 'club-1-ready-youth:contract'
  };
  state.clubs['club-1'].player_ids.push('club-1-ready-youth');
  state.contracts['club-1-ready-youth:contract'] = {
    contract_id: 'club-1-ready-youth:contract', player_id: 'club-1-ready-youth', club_id: 'club-1',
    start_at: at, end_at: '2029-06-30T23:59:59.000Z', wage: 250, status: 'active'
  };
  state.registrations['club-1-ready-youth'] = { player_id: 'club-1-ready-youth', club_id: 'club-1', registered: false, registered_at: null };

  const result = executeAiSquadPlan(state, { clubId: 'club-1', at });
  assert.ok(result.actions.some((row) => row.action === 'promote_youth' && row.player_id === 'club-1-ready-youth'));
  assert.equal(state.registrations['club-1-ready-youth'].registered, true);
  assert.equal(state.players['club-1-ready-youth'].promoted_to_senior_at, new Date(at).toISOString());
});

test('world management is deterministic in club order and leaves every club viable', () => {
  const state = stateWithFreeAgents();
  const results = manageWorldSquads(state, { at, preferredMinimum: 19 });

  assert.deepEqual(results.map((row) => row.club_id), ['club-1', 'club-2', 'club-3', 'club-4']);
  assert.equal(results.every((row) => row.accepted), true);
  assert.equal(results.every((row) => row.after.summary.registered_seniors >= 18), true);
});
