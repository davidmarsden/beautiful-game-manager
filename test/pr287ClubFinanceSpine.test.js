import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSquadCycleState, renewContract } from '../src/squadCycle/squadCycle.js';
import { transferPlayersAtomically } from '../src/squadCycle/atomicTransfers.js';
import { acquireFreeAgent } from '../src/squadCycle/freeAgentAcquisition.js';
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

test('#287 existing squad-cycle state bootstraps canonical club finances with usable headroom', () => {
  const cycle = state();
  assert.equal(cycle.finances, undefined);
  ensureClubFinanceState(cycle);
  assert.equal(cycle.finances.version, 'tbg-club-finance-v0.1');
  assert.equal(cycle.finances.clubs.A.cash_balance, 100000000);
  assert.equal(cycle.finances.clubs.B.cash_balance, 100000000);
  const summary = clubFinanceReadModel(cycle).A;
  assert.equal(summary.wage_bill, 2000);
  assert.equal(summary.wage_budget, 3000);
  assert.equal(summary.wage_headroom, 1000);
});

test('#287 an empty club bootstraps enough budget for one default-wage signing', () => {
  const cycle = createSquadCycleState({
    seasonId: 'S1-empty',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    clubs: [{ club_id: 'EMPTY', club_name: 'Empty', players: [] }]
  });
  const summary = clubFinanceReadModel(cycle).EMPTY;
  assert.equal(summary.wage_bill, 0);
  assert.equal(summary.wage_budget, 1000);
  assert.equal(summary.wage_headroom, 1000);
  const result = acquireFreeAgent(cycle, {
    player: { ...player('FA-EMPTY'), registered: false },
    toClubId: 'EMPTY',
    at,
    contractEndAt: '2029-06-30T23:59:59.000Z'
  });
  assert.equal(result.contract.wage, 1000);
});

test('#287 configured wage budgets remain fixed even when the current bill is already higher', () => {
  const cycle = state();
  cycle.finances = {
    version: 'tbg-club-finance-v0.1',
    clubs: {
      A: { club_id: 'A', currency: 'GBP', cash_balance: 100, wage_budget: 1500 },
      B: { club_id: 'B', currency: 'GBP', cash_balance: 100, wage_budget: 3000 }
    }
  };
  const summary = clubFinanceReadModel(cycle).A;
  assert.equal(summary.wage_bill, 2000);
  assert.equal(summary.wage_budget, 1500);
  assert.equal(summary.wage_headroom, 0);
  ensureClubFinanceState(cycle);
  assert.equal(cycle.finances.clubs.A.wage_budget, 1500);
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

test('#287 cash settlement preserves penny precision from immutable deal terms', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  cycle.finances.clubs.A.cash_balance = 20;
  cycle.finances.clubs.B.cash_balance = 0;
  applyCashLegsAtomically(cycle, {
    at,
    legs: [{ leg_type: 'cash', from_club_id: 'A', to_club_id: 'B', amount: 10.75 }]
  });
  assert.equal(cycle.finances.clubs.A.cash_balance, 9.25);
  assert.equal(cycle.finances.clubs.B.cash_balance, 10.75);
  const event = cycle.events.find((row) => row.type === 'cash_transferred');
  assert.equal(event.amount, 10.75);
});

test('#287 sub-penny cash terms are rejected at the immutable deal-leg persistence boundary', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260823b_cash_leg_penny_precision.sql', import.meta.url), 'utf8');
  assert.match(migration, /transfer_deal_legs_cash_penny_precision/);
  assert.match(migration, /amount = round\(amount, 2\)/);
  assert.match(migration, /not valid/i);
});

test('#287 insufficient cash rejects a legacy state without even lazy finance mutation', () => {
  const cycle = state();
  cycle.clubs.A.cash_balance = 25;
  cycle.clubs.B.cash_balance = 10;
  const before = JSON.stringify(cycle);

  assert.throws(() => applyCashLegsAtomically(cycle, {
    at,
    legs: [{ leg_type: 'cash', from_club_id: 'A', to_club_id: 'B', amount: 30 }]
  }), /A has insufficient cash/);

  assert.equal(JSON.stringify(cycle), before);
  assert.equal(cycle.finances, undefined);
  assert.equal(cycle.events.filter((row) => row.type === 'cash_transferred').length, 0);
});

test('#287 negative cash legs are rejected before mutation', () => {
  const cycle = state();
  const before = JSON.stringify(cycle);
  assert.throws(() => applyCashLegsAtomically(cycle, {
    at,
    legs: [{ leg_type: 'cash', from_club_id: 'A', to_club_id: 'B', amount: -1 }]
  }), /requires a non-negative amount/);
  assert.equal(JSON.stringify(cycle), before);
});

test('#287 incoming transfer wage is rejected before player or finance mutation when budget is exceeded', () => {
  const cycle = state();
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
  assert.equal(cycle.finances, undefined);
});

test('#287 standalone renewal cannot bypass the club wage budget', () => {
  const cycle = state();
  const before = JSON.stringify(cycle);
  assert.throws(() => renewContract(cycle, {
    playerId: 'A-1',
    clubId: 'A',
    at,
    endAt: '2029-06-30T23:59:59.000Z',
    wage: 5000
  }), /A wage budget exceeded/);
  assert.equal(JSON.stringify(cycle), before);
  assert.equal(cycle.finances, undefined);
});

test('#287 free-agent acquisition cannot bypass the club wage budget', () => {
  const cycle = state();
  ensureClubFinanceState(cycle);
  cycle.finances.clubs.A.wage_budget = 2000;
  const before = JSON.stringify(cycle);
  assert.throws(() => acquireFreeAgent(cycle, {
    player: { ...player('FA-1'), registered: false },
    toClubId: 'A',
    at,
    contractEndAt: '2029-06-30T23:59:59.000Z',
    wage: 999999
  }), /A wage budget exceeded/);
  assert.equal(JSON.stringify(cycle), before);
  assert.equal(cycle.players['FA-1'], undefined);
});

test('#287 manager read model exposes finance without mutating a legacy source world', () => {
  const cycle = state();
  const before = JSON.stringify(cycle);
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
  assert.equal(JSON.stringify(cycle), before);
  assert.equal(cycle.finances, undefined);
});
