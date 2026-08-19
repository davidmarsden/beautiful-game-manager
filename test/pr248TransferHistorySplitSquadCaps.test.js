import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSquadCycleState,
  transferPlayer,
  isYouthSquadPlayer
} from '../src/squadCycle/squadCycle.js';
import { buildWorldReadModel } from '../src/world/worldReadModel.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const player = (id, age) => ({ tbg_player_id: id, display_name: id, age, position: 'Central Midfield', underlying_ability_rating: 80 });

function club(clubId, seniorCount, youthCount) {
  return {
    club_id: clubId,
    club_name: clubId,
    players: [
      ...Array.from({ length: seniorCount }, (_, index) => player(`${clubId}-s-${index + 1}`, 24 + (index % 5))),
      ...Array.from({ length: youthCount }, (_, index) => player(`${clubId}-y-${index + 1}`, 18 + (index % 4)))
    ]
  };
}

test('squad cycle classifies youth at 21 and enforces independent 25/25 ownership cohorts', () => {
  assert.equal(isYouthSquadPlayer({ age: 21 }), true);
  assert.equal(isYouthSquadPlayer({ age: 22 }), false);
  assert.equal(isYouthSquadPlayer({ age: 22, season_start_age: 21 }), true);
  assert.equal(isYouthSquadPlayer({ age: 22, youth_eligible_at_season_start: true }), true);

  const state = createSquadCycleState({
    clubs: [club('seller', 1, 0), club('buyer', 24, 25)],
    seasonId: 'season-1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z'
  });
  const transferred = transferPlayer(state, {
    playerId: 'seller-s-1',
    fromClubId: 'seller',
    toClubId: 'buyer',
    at: '2026-08-19T10:00:00.000Z',
    contractEndAt: '2029-06-30T23:59:59.000Z'
  });
  assert.equal(transferred.club_id, 'buyer');
  assert.equal(state.squad_limits.first_team, 25);
  assert.equal(state.squad_limits.youth, 25);
});

test('first-team cap rejects a 26th senior even when the youth cohort has room', () => {
  const state = createSquadCycleState({
    clubs: [club('seller', 1, 0), club('buyer', 25, 2)],
    seasonId: 'season-1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z'
  });
  assert.throws(() => transferPlayer(state, {
    playerId: 'seller-s-1',
    fromClubId: 'seller',
    toClubId: 'buyer',
    at: '2026-08-19T10:00:00.000Z',
    contractEndAt: '2029-06-30T23:59:59.000Z'
  }), /first-team squad limit reached \(25\)/);
});

test('world read model drops heavyweight runtime/player state but preserves history and transfer identity fields', () => {
  const world = {
    world_id: 'world-1',
    season_number: 1,
    phase: 'season',
    clock: '2026-08-19T10:00:00.000Z',
    club_profiles: { a: { club_name: 'A' } },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['a'] }], movement_history: [] },
    squad_cycle: {
      season_id: 'season-1',
      registration_limit: 25,
      clubs: { a: { club_id: 'a', player_ids: ['p1'], registered_player_ids: ['p1'] } },
      players: { p1: { tbg_player_id: 'p1', display_name: 'Player One', club_id: 'a', age: 24, position: 'Centre-Back', underlying_ability_rating: 88, market_value_eur: 999999999, ability_profile: { huge: 'payload' } } },
      contracts: {},
      registrations: {}
    },
    matchday_cycle: {
      season_id: 'season-1', current_matchday: 9, maximum_matchday: 38, turn_calendar: {},
      runtimes: { d1: { fixtures: [], table: {}, archive_results: [], results: [], state: { players: { p1: { fitness: 12 } }, availability: { players: { p1: { injury_until_matchday: 99 } } } } } }
    },
    history: { archives: [] },
    completed_seasons: []
  };
  const model = buildWorldReadModel(world);
  assert.equal(model.squad_cycle.players.p1.display_name, 'Player One');
  assert.equal(model.squad_cycle.players.p1.market_value_eur, undefined);
  assert.equal(model.squad_cycle.players.p1.ability_profile, undefined);
  assert.equal(model.matchday_cycle.runtimes.d1.state, undefined);
  assert.deepEqual(model.squad_cycle.squad_limits, { first_team: 25, youth: 25 });
});

test('transfer history and recovery are first-class and agreement is guarded before binding', async () => {
  const [historySql, guardSql, endpoint, ui, refresh, settlement] = await Promise.all([
    read('supabase/migrations/20260819c_transfer_history_split_squad_recovery.sql'),
    read('supabase/migrations/20260819d_transfer_split_squad_capacity_guard.sql'),
    read('netlify/functions/transfer-history.mjs'),
    read('public/transfer-history.js'),
    read('netlify/functions/refresh-world-read-model.mjs'),
    read('netlify/functions/_lib/transfer-settlement.mjs')
  ]);
  assert.match(historySql, /get_manager_transfer_history_for_user/);
  assert.match(historySql, /status not in \('negotiating', 'agreed'\)/);
  assert.match(historySql, /settlement_error ilike '%registration limit reached%'/);
  assert.match(historySql, /refresh_world_read_model_if_current/);
  assert.match(guardSql, /transfer_deal_split_squad_capacity_guard/);
  assert.match(guardSql, /youth_eligible_at_season_start/);
  assert.match(guardSql, /season_start_age/);
  assert.match(guardSql, /first-team squad limit reached \(25\)/);
  assert.match(guardSql, /youth squad limit reached \(25\)/);
  assert.match(endpoint, /get_manager_transfer_history_for_user/);
  assert.match(ui, /Transfer history/);
  assert.match(ui, /Application failed/);
  assert.match(ui, /Completed/);
  assert.match(refresh, /schedule: '\*\/15 \* \* \* \*'/);
  assert.match(refresh, /buildWorldReadModel/);
  assert.match(refresh, /refresh_world_read_model_if_current/);
  assert.match(settlement, /first-team squad limit reached/);
  assert.match(settlement, /youth squad limit reached/);
});
