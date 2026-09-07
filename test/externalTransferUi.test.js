import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('external offer provenance is projected and firm-offer UI removes dead-end negotiation controls', async () => {
  const [projection, ui, navigation] = await Promise.all([
    read('supabase/migrations/20260907e_external_transfer_projection.sql'),
    read('public/external-transfer-ui.js'),
    read('public/portal-navigation.js')
  ]);

  assert.match(projection, /'deal_origin', deal_origin/);
  assert.match(projection, /'external_club_source_id', external_club_source_id/);
  assert.match(projection, /'external_club_name', external_club_name/);

  assert.match(ui, /external_market/);
  assert.match(ui, /transfer-counter-controls/);
  assert.match(ui, /propose_agreed_amendment/);
  assert.match(ui, /propose_agreed_cancellation/);
  assert.match(ui, /External market offer · firm bid · accept or decline/);
  assert.match(ui, /External market deal · fixed terms · awaiting completion/);
  assert.match(navigation, /import '\.\/external-transfer-ui\.js'/);
});
