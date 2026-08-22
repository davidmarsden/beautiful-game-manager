import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#272 composer makes dropdown selection distinct from added deal players', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Choose a player to add…/);
  assert.match(source, /Choosing a player here does not add them to the deal\. Press Add player\./);
  assert.match(source, /ensurePickerPlaceholder/);
});

test('#272 composer shows a final You receive / You give review and explicit Nothing sides', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Review this deal before sending/);
  assert.match(source, /appendSide\(panel, 'You receive', receive\)/);
  assert.match(source, /appendSide\(panel, 'You give', offer\)/);
  assert.match(source, /entries\.length \? entries : \['Nothing'\]/);
});

test('#272 one-sided deal warning identifies the manager-facing empty side correctly', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /Warning: you receive nothing in this deal\./);
  assert.match(source, /Warning: you give nothing in this deal\./);
  assert.doesNotMatch(source, /Warning: the other club gives nothing in this deal\./);
});

test('#272 one-sided new offer cannot be submitted without explicit acknowledgement', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /confirmOneSidedDeal/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /confirmedBefore/);
});

test('#272 one-sided counter cannot bypass acknowledgement through exchange response capture handler', async () => {
  const source = await read('public/transfer-exchange-response-ui.js');
  assert.match(source, /function assertOneSidedCounterConfirmed\(\)/);
  assert.match(source, /panel\?\.dataset\.oneSided !== 'true'/);
  assert.match(source, /confirmOneSidedDeal/);
  assert.match(source, /assertOneSidedCounterConfirmed\(\)/);
  const guardIndex = source.indexOf('assertOneSidedCounterConfirmed();');
  const apiIndex = source.indexOf("api('/api/transfer-exchange-response'", guardIndex);
  assert.ok(guardIndex >= 0 && apiIndex > guardIndex, 'counter acknowledgement must be enforced before the API write');
});

test('#272 hardening observer ignores review-panel mutations instead of self-looping', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /mutationComesFromReview/);
  assert.match(source, /!mutationComesFromReview\(mutation\)/);
});

test('#272 agreed multi-player deals do not expose legacy single-fee amendment UI or pending acceptance', async () => {
  const source = await read('public/transfer-deal-composer-hardening.js');
  assert.match(source, /suppressLegacyComplexAmendments/);
  assert.match(source, /amendment\.hidden = true/);
  assert.match(source, /accept_agreed_change/);
  assert.match(source, /acceptPending\.disabled = true/);
  assert.match(source, /acceptPending\.hidden = true/);
  assert.match(source, /Reject it to keep the agreed deal unchanged/);
  assert.match(source, /single-fee\/contract amendment form does not represent all deal legs/);
});

test('#272 database rejects legacy amendments on multi-player revisions even outside the UI', async () => {
  const migration = await read('supabase/migrations/20260822e_complex_agreed_amendment_guard.sql');
  assert.match(migration, /guard_complex_transfer_change_request/);
  assert.match(migration, /guard_complex_mutual_amendment_revision/);
  assert.match(migration, /permanent_player_count > 1/);
  assert.match(migration, /Legacy single-player amendments are not supported for multi-player deals/);
  assert.match(migration, /Legacy single-player amendment cannot replace a multi-player deal revision/);
  assert.match(migration, /before insert or update of change_type, deal_id, world_id/);
  assert.match(migration, /before insert\s+on public\.transfer_deal_revisions/);
});

test('#272 exchange controls load composer hardening', async () => {
  const source = await read('public/transfer-exchange-direct-controls.js');
  assert.match(source, /import '\.\/transfer-deal-composer-hardening\.js';/);
});
