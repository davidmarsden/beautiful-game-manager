import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSquadCycleState, squadCycleSnapshot } from '../src/squadCycle/squadCycle.js';
import { transferPlayersAtomically } from '../src/squadCycle/atomicTransfers.js';

const at = '2026-08-22T18:00:00.000Z';

function players(prefix, count, { age = 27 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix} Player ${index + 1}`,
    age,
    underlying_ability_rating: 80,
    registered: true
  }));
}

function cappedState() {
  return createSquadCycleState({
    seasonId: 'S1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    firstTeamSquadLimit: 25,
    youthSquadLimit: 25,
    clubs: [
      { club_id: 'A', club_name: 'Alpha', players: players('A', 25) },
      { club_id: 'B', club_name: 'Beta', players: players('B', 25) }
    ]
  });
}

test('#272 simultaneous 25↔25 swap succeeds without transient 26th-player failure', () => {
  const state = cappedState();
  transferPlayersAtomically(state, {
    at,
    legs: [
      { player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 3 },
      { player_id: 'B-1', from_club_id: 'B', to_club_id: 'A', contract_years: 4 }
    ]
  });

  assert.equal(state.players['A-1'].club_id, 'B');
  assert.equal(state.players['B-1'].club_id, 'A');
  assert.equal(state.clubs.A.player_ids.length, 25);
  assert.equal(state.clubs.B.player_ids.length, 25);
  assert.equal(state.clubs.A.registered_player_ids.length, 25);
  assert.equal(state.clubs.B.registered_player_ids.length, 25);
  assert.equal(new Date(state.contracts[state.players['A-1'].contract_id].end_at).getUTCFullYear(), 2029);
  assert.equal(new Date(state.contracts[state.players['B-1'].contract_id].end_at).getUTCFullYear(), 2030);
  assert.ok(Object.values(squadCycleSnapshot(state).checks).every(Boolean));
});

test('#272 many-for-one validates final squad capacity before any mutation', () => {
  const state = cappedState();
  const before = JSON.stringify(state);
  assert.throws(() => transferPlayersAtomically(state, {
    at,
    legs: [
      { player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 3 },
      { player_id: 'A-2', from_club_id: 'A', to_club_id: 'B', contract_years: 3 },
      { player_id: 'B-1', from_club_id: 'B', to_club_id: 'A', contract_years: 3 }
    ]
  }), /B first-team squad limit reached \(25\)/);
  assert.equal(JSON.stringify(state), before);
});

test('#272 invalid later ownership leg leaves the complete squad state untouched', () => {
  const state = cappedState();
  const before = JSON.stringify(state);
  assert.throws(() => transferPlayersAtomically(state, {
    at,
    legs: [
      { player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 3 },
      { player_id: 'B-1', from_club_id: 'A', to_club_id: 'B', contract_years: 3 }
    ]
  }), /B-1 is not owned by A/);
  assert.equal(JSON.stringify(state), before);
});

test('#272 duplicate player legs fail before mutation', () => {
  const state = cappedState();
  const before = JSON.stringify(state);
  assert.throws(() => transferPlayersAtomically(state, {
    at,
    legs: [
      { player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 3 },
      { player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 4 }
    ]
  }), /duplicate player A-1/);
  assert.equal(JSON.stringify(state), before);
});

test('#272 straight one-player settlement still records its transfer fee', () => {
  const state = createSquadCycleState({
    seasonId: 'S1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    clubs: [
      { club_id: 'A', club_name: 'Alpha', players: players('A', 2) },
      { club_id: 'B', club_name: 'Beta', players: players('B', 2) }
    ]
  });
  transferPlayersAtomically(state, {
    at,
    legs: [{ player_id: 'A-1', from_club_id: 'A', to_club_id: 'B', contract_years: 5, fee: 50000000 }]
  });
  const event = state.events.findLast((row) => row.type === 'player_transferred');
  assert.equal(event.fee, 50000000);
  assert.equal(event.atomic_exchange, false);
});

test('#272 due-settlement SQL projects one row per deal with every ordered leg', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260822c_atomic_exchange_due_projection.sql', import.meta.url), 'utf8');
  assert.match(sql, /'legs', coalesce\(\(/);
  assert.match(sql, /jsonb_agg\(jsonb_build_object\([\s\S]*order by leg\.sequence_no asc/);
  assert.doesNotMatch(sql, /join public\.transfer_deal_legs player_leg/);
});

test('#272 exchange response SQL creates a complete replacement revision and exact-revision approval', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260822b_exchange_revision_responses.sql', import.meta.url), 'utf8');
  assert.match(sql, /respond_manager_transfer_exchange_deal_for_user/);
  assert.match(sql, /current_revision_no <> p_revision_no/);
  assert.match(sql, /two_club_exchange_counter/);
  assert.match(sql, /jsonb_array_elements\(p_legs\) with ordinality/);
  assert.match(sql, /insert into public\.transfer_deal_approvals/);
  assert.match(sql, /approvals_count = participant_count/);
});

test('#272 exchange response gateway uses only the exchange revision responder and complete counter legs', async () => {
  const source = await readFile(new URL('../netlify/functions/transfer-exchange-response.mjs', import.meta.url), 'utf8');
  assert.match(source, /respond_manager_transfer_exchange_deal_for_user/);
  assert.match(source, /normalizeCounterLegs/);
  assert.match(source, /p_revision_no:\s*revisionNo/);
  assert.match(source, /p_legs:\s*legs/);
  assert.doesNotMatch(source, /respond_manager_transfer_deal_for_user/);
});
