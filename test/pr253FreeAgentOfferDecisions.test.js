import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freeAgentOfferExpectation, scoreFreeAgentOffer } from '../netlify/functions/_lib/free-agent-offers.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('free agents use a six-hour competing-offer window instead of immediate manager signing', async () => {
  const migration = await read('supabase/migrations/20260819i_free_agent_offer_decisions.sql');
  const endpoint = await read('netlify/functions/free-agents.mjs');
  const ui = await read('public/free-agent-offer-ui.js');

  assert.match(migration, /free_agent_offers/);
  assert.match(migration, /interval '6 hours'/);
  assert.match(migration, /one_pending_manager_player/);
  assert.match(endpoint, /action !== 'offer'/);
  assert.doesNotMatch(endpoint, /action !== 'sign'/);
  assert.match(ui, /Make offer/);
  assert.match(ui, /six-hour offer window/);
});

test('all clubs share the first offer deadline and a manager can revise terms without extending it', async () => {
  const migration = await read('supabase/migrations/20260819i_free_agent_offer_decisions.sql');
  assert.match(migration, /select min\(decision_at\)/);
  assert.match(migration, /shared_decision_at := coalesce\(shared_decision_at, now\(\) \+ interval '6 hours'\)/);
  assert.match(migration, /where world_id = p_world_id and manager_id = manager_id_value and player_id = p_player_id and status = 'pending'/);
  assert.match(migration, /set club_id = club_id_value,[\s\S]*contract_years = p_contract_years,[\s\S]*wage = p_wage/);
});

test('player expectation makes implausibly low offers rejectable while strong offers can qualify', () => {
  const player = { tbg_player_id: 'p1', tbg_rating: 87, market_value_eur: 25_000_000, position_group: 'Midfield' };
  assert.equal(freeAgentOfferExpectation(player), 50_000);
  const world = {
    squad_cycle: {
      players: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`c${index}`, {
        club_id: 'club-a', tbg_rating: 87, position_group: index < 5 ? 'Midfield' : 'Defence'
      }]))
    }
  };
  const low = scoreFreeAgentOffer({ world, offer: { club_id: 'club-a', player_snapshot: player, wage: 1000, contract_years: 3 } });
  const strong = scoreFreeAgentOffer({ world, offer: { club_id: 'club-a', player_snapshot: player, wage: 50_000, contract_years: 3 } });
  assert.ok(low.score < low.minimumScore);
  assert.ok(strong.score >= strong.minimumScore);
});

test('due player decisions settle on the existing CAS-safe acquisition path and reject losing offers', async () => {
  const resolver = await read('netlify/functions/_lib/free-agent-offers.mjs');
  const scheduler = await read('netlify/functions/settle-transfers.mjs');
  assert.match(resolver, /signFreeAgent\(/);
  assert.match(resolver, /player_chose_other_club/);
  assert.match(resolver, /terms_below_expectation/);
  assert.match(resolver, /status: 'accepted'/);
  assert.match(resolver, /status: 'rejected'/);
  assert.match(scheduler, /resolveScheduledFreeAgentOffers/);
  assert.match(scheduler, /schedule: '\*\/5 \* \* \* \*'/);
});

test('free-agent offer UI preserves request identity on network retry and refreshes after accepted decisions', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /tbg-free-agent-offer-request:/);
  assert.match(ui, /sessionStorage\.getItem\(key\)/);
  assert.match(ui, /sessionStorage\.removeItem\(request\.key\)/);
  assert.match(ui, /tbg-free-agent-accepted-seen:/);
  assert.match(ui, /window\.location\.reload\(\)/);
});

test('rejected free-agent decisions are merged into manager transfer history', async () => {
  const history = await read('netlify/functions/transfer-history.mjs');
  assert.match(history, /get_manager_free_agent_offer_history_for_user/);
  assert.match(history, /freeAgentOfferHistory/);
});
