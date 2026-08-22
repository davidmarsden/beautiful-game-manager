import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260822a_multi_player_exchange_offers.sql', import.meta.url);
const endpointUrl = new URL('../netlify/functions/transfer-deals.mjs', import.meta.url);
const uiUrl = new URL('../public/transfer-negotiations.js', import.meta.url);

test('#272 exchange offers reuse immutable deal legs and validate the whole proposed revision first', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /set_manager_transfer_exchange_offer_for_user/i);
  assert.match(sql, /jsonb_array_elements\(p_legs\) with ordinality/i);
  assert.match(sql, /permanent_transfer', 'cash/i);
  assert.match(sql, /same player cannot appear more than once/i);
  assert.match(sql, /not owned by the club offering that player/i);
  assert.match(sql, /player_leg_count = 0/i);
  assert.match(sql, /two_club_exchange_offer/i);
  assert.match(sql, /insert into public\.transfer_deal_revisions/i);
  assert.match(sql, /insert into public\.transfer_deal_legs/i);
  assert.match(sql, /insert into public\.transfer_deal_approvals/i);
  assert.doesNotMatch(sql, /manager_world_commands/i);
});

test('#272 exchange offers preserve per-player contract terms and allow many player legs in either direction', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /contract_years_value/i);
  assert.match(sql, /jsonb_build_object\('contract_years'/i);
  assert.match(sql, /from_club_id_value not in \(club_id_value, p_counterpart_club_id\)/i);
  assert.match(sql, /to_club_id_value not in \(club_id_value, p_counterpart_club_id\)/i);
  assert.doesNotMatch(sql, /player_leg_count\s*>\s*2/i);
  assert.match(sql, /player_leg_count := player_leg_count \+ 1/i);
  assert.match(sql, /for leg_value in select value from jsonb_array_elements\(normalized_legs\)[\s\S]*insert into public\.transfer_deal_legs/i);
});

test('#272 exposes additive current-revision leg projection without replacing the straight-transfer read model', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /get_manager_transfer_exchange_legs_for_user/i);
  assert.match(sql, /jsonb_agg\(jsonb_build_object/i);
  assert.match(sql, /leg\.sequence_no/i);
  assert.match(sql, /player_name/i);
  assert.match(sql, /position/i);
  assert.match(sql, /rating/i);
  assert.match(sql, /age/i);
  assert.match(sql, /revision\.revision_no = deal\.current_revision_no/i);
});

test('transfer gateway accepts normalized exchange leg sets and keeps complex responses out of single-player settlement', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /normalizeExchangeLegs/);
  assert.match(source, /action === 'exchange_offer'/);
  assert.match(source, /set_manager_transfer_exchange_offer_for_user/);
  assert.match(source, /get_manager_transfer_exchange_legs_for_user/);
  assert.match(source, /isComplexExchange/);
  assert.match(source, /accepting or countering it is disabled until #272 atomic exchange settlement is deployed/);
  assert.match(source, /responseAction !== 'decline'/);
});

test('complex-response safety is revision-intrinsic and fails closed when safety metadata is unavailable', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  const helperMatch = source.match(/async function currentDealSafety\(current, dealId\) \{([\s\S]*?)\n\}\n\nfunction isComplexExchange/);
  assert.ok(helperMatch, 'currentDealSafety helper should remain a distinct fail-closed boundary');
  const helper = helperMatch[1];

  assert.match(helper, /transfer_deal_revisions[\s\S]*select=summary/);
  assert.match(helper, /revisionType:\s*String\(revision\.summary\?\.type \|\| ''\)/);
  assert.doesNotMatch(helper, /\.catch\s*\(/);
  assert.match(helper, /Transfer deal safety metadata is unavailable/);
  assert.match(helper, /Transfer deal revision safety metadata is unavailable/);
  assert.match(helper, /Transfer deal leg safety metadata is unavailable/);

  assert.match(source, /revisionType === 'two_club_exchange_offer'/);
  assert.doesNotMatch(source, /leg\.from_club_id === ownClubId/);
});

test('exchange decoration collapses legacy one-row-per-leg projection to one card per deal', async () => {
  const source = await readFile(endpointUrl, 'utf8');
  assert.match(source, /function uniqueOffersByDeal/);
  assert.match(source, /seen\.has\(offer\.deal_id\)/);
  assert.match(source, /const decorate = \(offers\) => uniqueOffersByDeal\(offers\)\.map/);
});

test('Manager composer supports several players on both sides plus one-way cash adjustment', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /You receive/);
  assert.match(source, /You offer/);
  assert.match(source, /addReceivePlayer/);
  assert.match(source, /addOfferPlayer/);
  assert.match(source, /exchangeDraft\.receive\.forEach/);
  assert.match(source, /exchangeDraft\.offer\.forEach/);
  assert.match(source, /Cash from other club/);
  assert.match(source, /Cash from your club/);
  assert.match(source, /Cash must move in one direction only/);
  assert.match(source, /action: 'exchange_offer'/);
  assert.match(source, /legs,/);
  assert.match(source, /data-remove-exchange-player/);
  assert.match(source, /data-exchange-contract-player/);
});

test('straight one-player cash offers remain on the proven straight-transfer path', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /const isStraightTransfer = incomingPlayers\.length === 1 && outgoingPlayers\.length === 0 && !cashFromOther/);
  assert.match(source, /action: 'offer'/);
  assert.match(source, /seller_club_id: counterpartClubId/);
  assert.match(source, /contract_years: incomingPlayers\[0\]\.contract_years/);
});

test('complex exchange cards render every leg and do not offer unsafe accept/counter controls yet', async () => {
  const source = await readFile(uiUrl, 'utf8');
  assert.match(source, /dealLegSummary/);
  assert.match(source, /clubId\) => \{/);
  assert.match(source, /legText/);
  assert.match(source, /isComplexExchangeOffer/);
  assert.match(source, /response locked until atomic settlement is deployed/);
  assert.match(source, /Accept\/counter will be enabled by the next #272 slice/);
});
