import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageModifier,
  baseAnnualWageMillions,
  expectedWeeklyWage,
  migrateLegacyPlaceholderWages,
  reputationModifier,
  withExpectedInitialWages
} from '../src/squadCycle/expectedWage.js';
import { createPersistentWorld, loadPersistentWorld, savePersistentWorld } from '../src/world/persistentSeasonLoop.js';
import { clubFinanceSummary } from '../src/squadCycle/clubFinance.js';

test('expected wage follows the published logarithmic Ability curve with reputation and age modifiers', () => {
  assert.equal(Number(baseAnnualWageMillions(70).toFixed(1)), 1.2);
  assert.equal(Number(baseAnnualWageMillions(80).toFixed(1)), 4.0);
  assert.equal(Number(baseAnnualWageMillions(90).toFixed(1)), 10.0);
  assert.equal(reputationModifier(50), 1);
  assert.equal(reputationModifier(70), 1.1);
  assert.equal(ageModifier(20), 0.85);
  assert.equal(ageModifier(25), 1);
  assert.equal(expectedWeeklyWage({ underlying_ability_rating: 70, age: 25, reputation: 50 }), 23_100);
  assert.equal(expectedWeeklyWage({ underlying_ability_rating: 80, age: 25, reputation: 50 }), 76_900);
  assert.equal(expectedWeeklyWage({ underlying_ability_rating: 90, age: 25, reputation: 50 }), 192_300);
  assert.ok(expectedWeeklyWage({ underlying_ability_rating: 96, age: 25, reputation: 50 }) > 300_000);
});

test('initial wage seeding differentiates players while preserving explicit imported wages', () => {
  const [club] = withExpectedInitialWages([{ club_id: 'a', players: [
    { tbg_player_id: 'elite', underlying_ability_rating: 92, age: 27 },
    { tbg_player_id: 'starter', underlying_ability_rating: 82, age: 25 },
    { tbg_player_id: 'youth', underlying_ability_rating: 68, age: 19 },
    { tbg_player_id: 'explicit', underlying_ability_rating: 90, age: 25, contract: { wage: 12_345 } }
  ] }]);
  const wages = club.players.map((player) => player.contract.wage);
  assert.ok(wages[0] > wages[1]);
  assert.ok(wages[1] > wages[2]);
  assert.equal(wages[3], 12_345);
  assert.ok(new Set(wages.slice(0, 3)).size === 3);
});

test('legacy migration replaces only original £1,000 seed contracts and leaves negotiated £1,000 deals alone', () => {
  const world = {
    squad_cycle: {
      players: {
        p1: { tbg_player_id: 'p1', underlying_ability_rating: 90, age: 25, club_id: 'a' },
        p2: { tbg_player_id: 'p2', underlying_ability_rating: 90, age: 25, club_id: 'a' }
      },
      contracts: {
        original: { contract_id: 'p1:a:contract', player_id: 'p1', club_id: 'a', wage: 1000, status: 'active' },
        negotiated: { contract_id: 'p2:a:2026-09-01T00:00:00.000Z', player_id: 'p2', club_id: 'a', wage: 1000, status: 'active' }
      }
    }
  };
  const migrated = migrateLegacyPlaceholderWages(world);
  assert.equal(migrated, 1);
  assert.equal(world.squad_cycle.contracts.original.wage, 192_300);
  assert.equal(world.squad_cycle.contracts.negotiated.wage, 1000);
});

test('persistent worlds seed differentiated wages and reconcile finance after loading a legacy placeholder save', () => {
  const clubs = [
    { club_id: 'a', club_name: 'A', players: [{ tbg_player_id: 'a1', underlying_ability_rating: 90, age: 25 }] },
    { club_id: 'b', club_name: 'B', players: [{ tbg_player_id: 'b1', underlying_ability_rating: 70, age: 20 }] }
  ];
  const fresh = createPersistentWorld({ clubs, humanClubId: 'a' });
  const aContract = fresh.squad_cycle.contracts[fresh.squad_cycle.players.a1.contract_id];
  const bContract = fresh.squad_cycle.contracts[fresh.squad_cycle.players.b1.contract_id];
  assert.equal(aContract.wage, 192_300);
  assert.equal(bContract.wage, 19_600);

  aContract.wage = 1000;
  fresh.squad_cycle.finances = { version: 'legacy', clubs: { a: { club_id: 'a', currency: 'GBP', cash_balance: 100_000_000, wage_budget: 101_000 } } };
  const restored = loadPersistentWorld(savePersistentWorld(fresh));
  const migratedContract = restored.squad_cycle.contracts[restored.squad_cycle.players.a1.contract_id];
  assert.equal(migratedContract.wage, 192_300);
  const finance = clubFinanceSummary(restored.squad_cycle, 'a');
  assert.equal(finance.wage_bill, 192_300);
  assert.ok(finance.wage_budget >= finance.wage_bill);
});
