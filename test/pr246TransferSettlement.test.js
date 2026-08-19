import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('transfer lifecycle schedules mistake grace, binding and delayed settlement', async () => {
  const sql = await read('supabase/migrations/20260819a_transfer_grace_binding_settlement.sql');
  assert.match(sql, /grace_expires_at := anchor_at \+ interval '15 minutes'/);
  assert.match(sql, /binding_at := anchor_at \+ interval '15 minutes'/);
  assert.match(sql, /settle_at := anchor_at \+ interval '3 hours'/);
  assert.match(sql, /where status = 'agreed'/);
  assert.match(sql, /effective_state[\s\S]*'grace_period'[\s\S]*'binding'/);
});

test('mistake-grace cancellation is participant-gated, locked and audit-safe', async () => {
  const sql = await read('supabase/migrations/20260819a_transfer_grace_binding_settlement.sql');
  assert.match(sql, /cancel_manager_transfer_deal_in_grace_for_user/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /transfer_deal_participants[\s\S]*participant\.club_id = club_id_value/);
  assert.match(sql, /now\(\) >= coalesce\(deal_row\.grace_expires_at/);
  assert.match(sql, /set status = 'cancelled_in_grace'/);
  assert.match(sql, /cancelled_during_mistake_grace/);
});

test('due settlement uses checksum CAS and updates canonical read model atomically', async () => {
  const sql = await read('supabase/migrations/20260819a_transfer_grace_binding_settlement.sql');
  assert.match(sql, /get_due_transfer_settlements/);
  assert.match(sql, /deal\.settle_at <= now\(\)/);
  assert.match(sql, /apply_transfer_deal_settlement/);
  assert.match(sql, /save_checksum = p_expected_checksum/);
  assert.match(sql, /turn_status = 'open'/);
  assert.match(sql, /world_read_model_cache/);
  assert.match(sql, /source_checksum = excluded\.source_checksum/);
  assert.match(sql, /set status = 'completed'/);
  assert.match(sql, /settlement_replacement_checksum/);
});

test('settlement runner applies governed transfer and reconciles ambiguous outcomes', async () => {
  const source = await read('netlify/functions/_lib/transfer-settlement.mjs');
  assert.match(source, /loadPersistentWorld/);
  assert.match(source, /savePersistentWorld/);
  assert.match(source, /transferPlayer\(world\.squad_cycle/);
  assert.match(source, /apply_transfer_deal_settlement/);
  assert.match(source, /reconcileSettlement/);
  assert.match(source, /settlement_replacement_checksum/);
  assert.match(source, /fail_transfer_deal_application/);
});

test('settlement runs independently of matchday turns and opportunistically on transfer reads', async () => {
  const [scheduled, gateway] = await Promise.all([
    read('netlify/functions/settle-transfers.mjs'),
    read('netlify/functions/transfer-deals.mjs')
  ]);
  assert.match(scheduled, /schedule: '\*\/5 \* \* \* \*'/);
  assert.match(scheduled, /settleDueTransfers/);
  assert.match(gateway, /settleDueTransfers\(\{ worldId: current\.appointment\.world_id, limit: 5 \}\)/);
  assert.match(gateway, /get_manager_transfer_lifecycle_for_user/);
  assert.match(gateway, /cancel_in_grace/);
  assert.match(gateway, /15-minute mistake-grace period/);
});

test('manager UI explains grace and binding deadlines and exposes unilateral grace cancellation', async () => {
  const source = await read('public/transfer-negotiations.js');
  assert.match(source, /Deal agreed · mistake grace/);
  assert.match(source, /Unilateral cancellation available until/);
  assert.match(source, /Deal binding · awaiting completion/);
  assert.match(source, /cancellation now requires mutual consent/);
  assert.match(source, /data-agreed-change-action="cancel_in_grace"/);
  assert.match(source, /Cancelling during mistake grace/);
});
