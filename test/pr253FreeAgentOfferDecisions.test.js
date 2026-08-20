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

test('all clubs share the first offer deadline, revisions do not extend it, and expired windows reject new terms', async () => {
  const migration = await read('supabase/migrations/20260819i_free_agent_offer_decisions.sql');
  assert.match(migration, /select min\(decision_at\)/);
  assert.match(migration, /shared_decision_at is not null and shared_decision_at <= now\(\)/);
  assert.match(migration, /The free-agent offer window has closed/);
  assert.match(migration, /shared_decision_at := coalesce\(shared_decision_at, now\(\) \+ interval '6 hours'\)/);
  assert.match(migration, /where world_id = p_world_id and manager_id = manager_id_value and player_id = p_player_id and status = 'pending'/);
  assert.match(migration, /set club_id = club_id_value,[\s\S]*contract_years = p_contract_years,[\s\S]*wage = p_wage/);
  const replayIndex = migration.indexOf('request_key = p_request_key');
  const deadlineIndex = migration.indexOf('shared_decision_at is not null and shared_decision_at <= now()');
  assert.ok(replayIndex >= 0 && deadlineIndex > replayIndex, 'idempotent request replay must remain valid after the deadline');
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

test('scheduled decisions choose distinct due worlds before applying the world limit', async () => {
  const migration = await read('supabase/migrations/20260819i_free_agent_offer_decisions.sql');
  const scheduler = await read('netlify/functions/_lib/free-agent-offer-scheduler.mjs');
  assert.match(migration, /get_due_free_agent_world_ids/);
  assert.match(migration, /group by offer\.world_id/);
  assert.match(migration, /min\(offer\.decision_at\) as earliest_due/);
  assert.match(scheduler, /rpc\/get_due_free_agent_world_ids/);
  assert.doesNotMatch(scheduler, /select=world_id[\s\S]*limit=/);
});

test('free-agent offer UI preserves request identity on network retry, avoids observer mutation loops and refreshes after accepted decisions', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /tbg-free-agent-offer-request:/);
  assert.match(ui, /sessionStorage\.getItem\(key\)/);
  assert.match(ui, /sessionStorage\.removeItem\(request\.key\)/);
  assert.match(ui, /if \(button\.textContent !== 'Make offer'\) button\.textContent = 'Make offer'/);
  assert.match(ui, /tbg-free-agent-accepted-seen:/);
  assert.match(ui, /window\.location\.reload\(\)/);
});

test('free-agent offer confirmation formats decision timestamp in the browser timezone', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /formatDecision\(data\.decision_at\)/);
  assert.match(ui, /date\.toLocaleString\('en-GB', \{ dateStyle: 'short', timeStyle: 'short' \}\)/);
  assert.doesNotMatch(ui, /message\.textContent = data\.message \|\| 'Contract offer submitted\.'/);
});

test('pending free-agent offers stay visible in the main outgoing transfer dashboard and count', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /function renderPendingOffersInTransferSummary/);
  assert.match(ui, /document\.getElementById\('outgoingTransferOffers'\)/);
  assert.match(ui, /data-free-agent-outgoing-summary/);
  assert.match(ui, /Awaiting player decision/);
  assert.match(ui, /document\.getElementById\('transferNegotiationStatus'\)/);
  assert.match(ui, /function nativeOutgoingOfferCount/);
  assert.match(ui, /querySelectorAll\(':scope > article\.incoming-transfer-offer'\)/);
  assert.match(ui, /nativeOutgoing \+ pending\.length/);
  assert.match(ui, /latestFreeAgentOffers = offers/);
});

test('free-agent outgoing projection restores the native empty state after the final pending bid ends', async () => {
  const ui = await read('public/free-agent-offer-ui.js');
  assert.match(ui, /function restoreOutgoingEmptyState/);
  assert.match(ui, /No active outgoing offers\./);
  assert.match(ui, /host\?\.remove\(\);[\s\S]*restoreOutgoingEmptyState\(outgoing\)/);
  assert.doesNotMatch(ui, /freeAgentBaseOutgoing/);
  assert.doesNotMatch(ui, /freeAgentRenderedStatus/);
});

test('rejected free-agent decisions are merged into manager transfer history', async () => {
  const history = await read('netlify/functions/transfer-history.mjs');
  assert.match(history, /get_manager_free_agent_offer_history_for_user/);
  assert.match(history, /freeAgentOfferHistory/);
});
