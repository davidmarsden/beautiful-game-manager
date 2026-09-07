import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSquadCycleState } from '../src/squadCycle/squadCycle.js';
import { ensureClubFinanceState } from '../src/squadCycle/clubFinance.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { governedExternalOffer } from '../netlify/functions/_lib/external-transfer-offers.mjs';
import { applyExternalTransferToWorld } from '../netlify/functions/_lib/external-transfer-settlement.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('external offer value is deterministic and remains inside the acceptable fair-value band', () => {
  const input = { marketValue: 10_000_000, askingFee: 50_000_000, seed: 'world|player|club' };
  const first = governedExternalOffer(input);
  const second = governedExternalOffer(input);
  assert.equal(first, second);
  assert.ok(first >= 9_000_000);
  assert.ok(first <= 11_000_000);
  assert.ok(governedExternalOffer({ marketValue: 0, askingFee: 0, seed: 'floor' }) >= 100_000);
});

test('external settlement removes managed ownership, preserves the player as external, and credits the seller', () => {
  const state = createSquadCycleState({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'external-sale-season',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z'
  });
  ensureClubFinanceState(state);
  const seller = state.clubs['club-1'];
  const playerId = seller.player_ids[0];
  const player = state.players[playerId];
  const contract = state.contracts[player.contract_id];
  const openingCash = state.finances.clubs[seller.club_id].cash_balance;
  const world = { clock: '2026-08-15T12:00:00.000Z', squad_cycle: state, player_ownership: [], matchday_cycle: { runtimes: {} } };
  const due = {
    deal_id: 'external-deal-1',
    deal_origin: 'external_market',
    external_club_source_id: '1234',
    external_club_name: 'Example FC',
    legs: [
      { sequence_no: 1, leg_type: 'permanent_transfer', from_club_id: seller.club_id, to_club_id: 'Example FC', player_id: playerId },
      { sequence_no: 2, leg_type: 'cash', from_club_id: 'Example FC', to_club_id: seller.club_id, amount: 5_000_000 }
    ]
  };

  const result = applyExternalTransferToWorld(world, due);
  assert.equal(result.external_club_name, 'Example FC');
  assert.equal(player.club_id, null);
  assert.equal(player.assignment_status, 'external');
  assert.equal(player.external_club_source_id, '1234');
  assert.equal(player.external_club_name, 'Example FC');
  assert.equal(contract.status, 'transferred_external');
  assert.equal(seller.player_ids.includes(playerId), false);
  assert.equal(seller.registered_player_ids.includes(playerId), false);
  assert.equal(state.registrations[playerId].registered, false);
  assert.equal(state.finances.clubs[seller.club_id].cash_balance, openingCash + 5_000_000);
  assert.ok(state.events.some((event) => event.type === 'player_transferred_external' && event.player_id === playerId));
});

test('external transfer migration keeps TPF provenance and separates external settlement from managed clubs', async () => {
  const [offerSql, settlementSql, queueSql, eventsSql, generator, scheduled] = await Promise.all([
    read('supabase/migrations/20260907a_external_transfer_offers.sql'),
    read('supabase/migrations/20260907b_external_transfer_settlement_projection.sql'),
    read('supabase/migrations/20260907c_external_offer_candidate_queue.sql'),
    read('supabase/migrations/20260907d_external_transfer_events.sql'),
    read('netlify/functions/_lib/external-transfer-offers.mjs'),
    read('netlify/functions/settle-transfers.mjs')
  ]);

  assert.match(offerSql, /deal_origin[\s\S]*external_market/);
  assert.match(offerSql, /external_club_source_id/);
  assert.match(offerSql, /external_club_name/);
  assert.match(offerSql, /create_external_transfer_offer/);
  assert.match(offerSql, /manager_id drop not null/i);
  assert.match(offerSql, /External club offers are firm: accept or decline this offer/);

  assert.match(settlementSql, /deal\.deal_origin <> 'external_market'/);
  assert.match(settlementSql, /get_due_external_transfer_settlements/);
  assert.match(settlementSql, /deal\.deal_origin = 'external_market'/);

  assert.match(queueSql, /get_external_offer_candidate_listings/);
  assert.match(queueSql, /not exists[\s\S]*deal\.deal_origin = 'external_market'/);

  assert.match(eventsSql, /transfer_deal_events[\s\S]*manager_id drop not null/);
  assert.match(eventsSql, /emit_external_transfer_offered_event/);
  assert.match(eventsSql, /new\.manager_id is null/);
  assert.match(eventsSql, /participant\.manager_id is not distinct from new\.manager_id/);

  assert.match(generator, /beautiful-game-data\/main\/derived\/player-database\/player-database\.json/);
  assert.match(generator, /current_club_id/);
  assert.match(generator, /real_life_club/);
  assert.match(generator, /Every listing must have an acceptable external market/);
  assert.match(generator, /get_external_offer_candidate_listings/);
  assert.doesNotMatch(generator, /Math\.random/);

  assert.match(scheduled, /generateScheduledExternalOffers/);
  assert.match(scheduled, /settleDueExternalTransfers/);
});
