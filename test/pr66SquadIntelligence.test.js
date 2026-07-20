import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSquad, analyseWorldSquads } from '../src/intelligence/squadIntelligence.js';
import { createSquadCycleState, unregisterPlayer } from '../src/squadCycle/squadCycle.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

function intelligenceState() {
  return createSquadCycleState({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'pr66-intelligence',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z'
  });
}

test('derives a viable depth chart, roles and contract horizons from squad-cycle state', () => {
  const state = intelligenceState();
  const report = analyseSquad(state, { clubId: 'club-1', at: '2026-08-01T00:00:00.000Z' });

  assert.equal(report.viable, true);
  assert.equal(report.summary.registered_seniors, 19);
  assert.equal(report.summary.hard_minimum_gap, 0);
  assert.equal(report.summary.preferred_minimum_gap, 3);
  assert.equal(report.coverage.every((row) => row.registered_gap === 0), true);
  assert.equal(report.players.filter((row) => row.squad_role === 'key_player').length, 4);
  assert.ok(report.players.some((row) => row.contract_horizon === 'expiring_this_season'));
  assert.ok(report.needs.some((row) => row.type === 'squad_size' && row.severity === 'high'));
});

test('distinguishes structural registration gaps from temporary availability gaps', () => {
  const state = intelligenceState();
  const defenderId = state.clubs['club-1'].registered_player_ids.find((id) => state.players[id].position === 'Centre-Back');
  unregisterPlayer(state, { clubId: 'club-1', playerId: defenderId, at: '2026-08-20T12:00:00.000Z', reason: 'squad_balance' });

  const structural = analyseSquad(state, { clubId: 'club-1', at: '2026-08-20T12:00:00.000Z' });
  const defenderCoverage = structural.coverage.find((row) => row.group === 'defender');
  assert.equal(defenderCoverage.registered_gap, 1);
  assert.equal(structural.viable, false);
  assert.ok(structural.needs.some((row) => row.type === 'position_group' && row.group === 'defender'));

  const restored = intelligenceState();
  const unavailableDefenders = restored.clubs['club-1'].registered_player_ids
    .filter((id) => ['Right-Back', 'Centre-Back', 'Left-Back'].includes(restored.players[id].position))
    .slice(0, 2);
  const availability = Object.fromEntries(unavailableDefenders.map((id) => [id, { available: false, reason: 'injured' }]));
  const temporary = analyseSquad(restored, { clubId: 'club-1', at: '2026-08-20T12:00:00.000Z', availability });
  assert.equal(temporary.coverage.find((row) => row.group === 'defender').registered_gap, 0);
  assert.equal(temporary.coverage.find((row) => row.group === 'defender').available_gap, 2);
  assert.ok(temporary.needs.some((row) => row.type === 'temporary_availability' && row.group === 'defender'));
});

test('marks owned unregistered youth as prospects rather than senior cover', () => {
  const state = intelligenceState();
  const youthId = 'club-1-test-prospect';
  state.players[youthId] = {
    tbg_player_id: youthId,
    display_name: 'Test Prospect',
    club_id: 'club-1',
    age: 17,
    position: 'Centre-Forward',
    underlying_ability_rating: 68,
    youth_intake_season: state.season_id,
    contract_id: `${youthId}:contract`
  };
  state.clubs['club-1'].player_ids.push(youthId);
  state.contracts[`${youthId}:contract`] = {
    contract_id: `${youthId}:contract`, player_id: youthId, club_id: 'club-1',
    start_at: '2026-08-01T00:00:00.000Z', end_at: '2029-06-30T23:59:59.000Z', wage: 250, status: 'active'
  };
  state.registrations[youthId] = { player_id: youthId, club_id: 'club-1', registered: false, registered_at: null };

  const report = analyseSquad(state, { clubId: 'club-1', at: '2026-08-01T00:00:00.000Z' });
  const youth = report.players.find((row) => row.player_id === youthId);
  assert.equal(youth.squad_role, 'prospect');
  assert.equal(youth.registered, false);
  assert.equal(report.summary.registered_seniors, 19);
});

test('world analysis is deterministic and covers every club once', () => {
  const state = intelligenceState();
  const first = analyseWorldSquads(state, { at: '2026-08-01T00:00:00.000Z' });
  const second = analyseWorldSquads(state, { at: '2026-08-01T00:00:00.000Z' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((row) => row.club_id), ['club-1', 'club-2', 'club-3', 'club-4']);
});
