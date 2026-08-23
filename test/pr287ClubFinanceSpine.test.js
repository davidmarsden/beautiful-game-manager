import test from 'node:test';
import assert from 'node:assert/strict';
import { createSquadCycleState } from '../src/squadCycle/squadCycle.js';
import { transferPlayersAtomically } from '../src/squadCycle/atomicTransfers.js';
import {
  applyCashLegsAtomically,
  clubFinanceReadModel,
  ensureClubFinanceState
} from '../src/squadCycle/clubFinance.js';
import { buildWorldReadModel } from '../src/world/worldReadModel.js';

const at = '2026-08-22T18:00:00.000Z';

function player(id, age = 27) {
  return {
    tbg_player_id: id,
    display_name: id,
    age,
    underlying_ability_rating: 80,
    registered: true
  };
}

function state() {
  return createSquadCycleState({
    seasonId: 'S1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    clubs: [
      { club_id: 'A', club_name: 'Alpha', players: [player('A-1'), player('A-2')] },
      { club_id: 'B', club_name: 'Beta', players: [player('B-1'), player('B-2')] }
    ]
  });
}

test('#287 existing squad-cycle state bootstraps canonical club finances safely', () => {
  const cycle = state();
  assert.equal(cycle.finances, undefined);
  ensureClubFinanceState(cycle);
  assert.equal(cycle.finances.version, 'tbg-club-finance-v0.1');
  assert.equal(cycle.finances.clubs.A.cash_balance, 100000000);
  assert.equal(cycle.finances.clubs.B.cash_balance, 100000000);
  const summary = clubFinanceReadModel(cycle).A;
  assert.equal(summary.wage_bill, 2000);
  assert.equal(summary.wage_budget, 2400);
  assert.equal(summary.wage_headroom, 400);
});

test('#287 cash legs settle by final net position, not arbitrary leg order', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  cycle.finances.clubs.A.cash_balance = 100;
  cycle.finances.clubs.B.cash_balance = 0;

  applyCashLegsAtomically(cycle, {
    at,
    legs: [
      { leg_type: 'cash', from_club_id: 'B', to_club_id: 'A', amount: 50 },
      { leg_type: 'cash', from_club_id: 'A', to_club_id: 'B', amount: 120 }
    ]
  });

  assert.equal(cycle.finances.clubs.A.cash_balance, 30);
  assert.equal(cycle.finances.clubs.B.cash_balance, 70);
  assert.equal(cycle.events.filter((row) => row.type === 'cash_transferred').length, 2);
});

test('#287 insufficient cash rejects complete deal before any finance mutation', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  cycle.finances.clubs.A.cash_balance = 25;
  cycle.finances.clubs.B.cash_balance = 10;
  const before = JSON.stringify(cycle.finances);

  assert.throws(() => applyCashLegsAtomically(cycle, {
    at,
    legs: [{ leg_type: 'cash', from_club_id: 'A', to_club_id: 'B', amount: 30 }]
  }), /A has insufficient cash/);

  assert.equal(JSON.stringify(cycle.finances), before);
  assert.equal(cycle.events.filter((row) => row.type === 'cash_transferred').length, 0);
});

test('#287 incoming transfer wage is rejected before player mutation when budget is exceeded', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  const before = JSON.stringify(cycle);

  assert.throws(() => transferPlayersAtomically(cycle, {
    at,
    legs: [{
      player_id: 'A-1',
      from_club_id: 'A',
      to_club_id: 'B',
      contract_years: 3,
      wage: 5000
    }]
  }), /B wage budget exceeded/);

  assert.equal(JSON.stringify(cycle), before);
});

test('#287 manager read model exposes compact finance summary and contract wages', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  const model = buildWorldReadModel({
    world_id: 'world-1',
    season_number: 1,
    phase: 'season',
    squad_cycle: cycle
  });
  assert.equal(model.squad_cycle.finances.A.cash_balance, 100000000);
  assert.equal(model.squad_cycle.finances.A.wage_bill, 2000);
  const contract = Object.values(model.squad_cycle.contracts).find((row) => row.club_id === 'A');
  assert.equal(contract.wage, 1000);
});
