import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = 'supabase/migrations/20260825_world_transfer_register.sql';

test('#330 keeps negotiation private and exposes only deals that crossed official agreement', async () => {
  const sql = await read(migration);

  assert.match(sql, /create or replace function public\.get_world_transfer_register_for_user/);
  assert.match(sql, /deal\.grace_expires_at is not null/);
  assert.match(sql, /`grace_expires_at` is only created when both participants accept an exact/);
  assert.doesNotMatch(sql, /deal\.status not in \('negotiating'/);
  assert.match(sql, /greatest\(1, least\(coalesce\(p_limit, 100\), 200\)\)/);
});

test('#330 world register exposes the exact current revision package and deal-level lifecycle', async () => {
  const sql = await read(migration);

  assert.match(sql, /revision\.revision_no = deal\.current_revision_no/);
  assert.match(sql, /where leg\.revision_id = deal\.revision_id/);
  assert.match(sql, /'legs', coalesce/);
  assert.match(sql, /'grace_expires_at', deal\.grace_expires_at/);
  assert.match(sql, /'binding_at', deal\.binding_at/);
  assert.match(sql, /'settle_at', deal\.settle_at/);
  assert.match(sql, /'integrity_level', deal\.integrity_level/);
});

test('#330 private reports are service-only, structured and idempotent per manager/deal', async () => {
  const sql = await read(migration);

  assert.match(sql, /create table if not exists public\.transfer_integrity_reports/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.transfer_integrity_reports from public, anon, authenticated/);
  assert.match(sql, /unique \(deal_id, reporter_manager_id\)/);
  assert.match(sql, /suspected_collusion_multi_accounting/);
  assert.match(sql, /deliberate_club_wrecking/);
  assert.match(sql, /repeated_one_sided_dealing/);
  assert.match(sql, /rules_circumvention/);
  assert.match(sql, /other_competitive_integrity/);
  assert.match(sql, /Only publicly accepted transfer deals can be reported/);
});

test('#330 submitting a report cannot automatically alter a transfer', async () => {
  const sql = await read(migration);
  const functionStart = sql.indexOf('create or replace function public.submit_transfer_integrity_report_for_user');
  const functionEnd = sql.indexOf('$$;', functionStart);
  const body = sql.slice(functionStart, functionEnd);

  assert.match(body, /insert into public\.transfer_integrity_reports/);
  assert.doesNotMatch(body, /update\s+public\.transfer_deals/i);
  assert.doesNotMatch(body, /delete\s+from\s+public\.transfer_deals/i);
  assert.match(body, /report creates an admin-review record only/i);
});

test('#330 manager endpoint verifies auth/world membership and uses service-only RPCs', async () => {
  const source = await read('netlify/functions/world-transfers.mjs');

  assert.match(source, /\/auth\/v1\/user/);
  assert.match(source, /manager_appointments\?manager_id=eq\./);
  assert.match(source, /status=eq\.active/);
  assert.match(source, /get_world_transfer_register_for_user/);
  assert.match(source, /submit_transfer_integrity_report_for_user/);
  assert.match(source, /payload\.action !== 'report'/);
});

test('#330 portal labels the transparency boundary and reports privately', async () => {
  const [ui, loader] = await Promise.all([
    read('public/world-transfer-register.js'),
    read('public/internal-profile-links.js')
  ]);

  assert.match(loader, /import '\.\/world-transfer-register\.js';/);
  assert.match(ui, /Private negotiation, public agreement/);
  assert.match(ui, /Report transfer/);
  assert.match(ui, /Send private report/);
  assert.match(ui, /data-world-transfer-report-reason/);
  assert.match(ui, /already_reported_by_me/);
  assert.match(ui, /effective_state === 'grace_period'/);
  assert.match(ui, /effective_state === 'binding'/);
});
