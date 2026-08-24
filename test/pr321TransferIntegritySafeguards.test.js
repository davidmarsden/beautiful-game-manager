import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20260824_transfer_integrity_safeguards.sql';

test('#321 agreement boundary centrally enforces the unordered club-pair season cap', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /create or replace function public\.guard_transfer_deal_integrity\(\)/);
  assert.match(sql, /new\.status <> 'agreed'/);
  assert.match(sql, /min\(participant\.club_id\)/);
  assert.match(sql, /max\(participant\.club_id\)/);
  assert.match(sql, /hashtextextended\([\s\S]*'transfer-integrity'/);
  assert.match(sql, /pg_advisory_xact_lock\(pair_lock_key\)/);
  assert.match(sql, /deal\.status in \('agreed', 'completed'\)/);
  assert.match(sql, /pair_reserved_count >= 3/);
  assert.match(sql, /Seasonal transfer limit reached/);

  // One deal row is one package: the cap does not count transfer_deal_legs.
  const capSection = sql.slice(sql.indexOf('select count(*) into pair_reserved_count'), sql.indexOf("if pair_reserved_count >= 3"));
  assert.doesNotMatch(capSection, /transfer_deal_legs/);
});

test('#321 cancelled or failed deals release the pair slot by construction', async () => {
  const sql = await read(migrationPath);
  const capSection = sql.slice(sql.indexOf('select count(*) into pair_reserved_count'), sql.indexOf("if pair_reserved_count >= 3"));

  assert.match(capSection, /'agreed', 'completed'/);
  assert.doesNotMatch(capSection, /cancelled_in_grace/);
  assert.doesNotMatch(capSection, /application_failed/);
  assert.doesNotMatch(capSection, /mutually_cancelled/);
});

test('#321 stewardship assessment uses canonical ratings and narrow public thresholds', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /cache\.source_checksum <> canonical_checksum/);
  assert.match(sql, /squad_cycle,players/);
  assert.match(sql, /underlying_ability_rating/);
  assert.match(sql, /club_rank <= 5/);
  assert.match(sql, /top5_outgoing_a >= 3 and incoming_a = 0/);
  assert.match(sql, /top5_outgoing_b >= 3 and incoming_b = 0/);
  assert.match(sql, /Board refusal:/);
  assert.match(sql, /top5_outgoing_a >= 2/);
  assert.match(sql, /top5_outgoing_b >= 2/);
  assert.match(sql, /outgoing_a >= 4 and incoming_a = 0/);
  assert.match(sql, /integrity_cooling_minutes := case when warning_value then 1440 else 15 end/);

  // #321 deliberately does not invent a market-value/fair-price oracle.
  assert.doesNotMatch(sql, /market_value/);
  assert.doesNotMatch(sql, /fair_value/);
});

test('#321 warning cooling remains binding-safe and normal deals retain the existing three-hour settlement', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /make_interval\(mins => greatest\(15, least\(coalesce\(new\.integrity_cooling_minutes, 15\), 1440\)\)\)/);
  assert.match(sql, /new\.grace_expires_at := anchor_at \+ cooling_interval/);
  assert.match(sql, /new\.binding_at := anchor_at \+ cooling_interval/);
  assert.match(sql, /new\.settle_at := anchor_at \+ cooling_interval \+ interval '2 hours 45 minutes'/);
});

test('#321 official deal principle and assessment are manager-visible through lifecycle state', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /binding_authority text not null default 'tbg_transfer_mechanism_only'/);
  assert.match(sql, /binding_authority = 'tbg_transfer_mechanism_only'/);
  assert.match(sql, /External promises are non-binding/);
  assert.match(sql, /'integrity_level', deal\.integrity_level/);
  assert.match(sql, /'integrity_reasons', deal\.integrity_reasons/);
  assert.match(sql, /'integrity_assessment', deal\.integrity_assessment/);
  assert.match(sql, /'external_agreements_binding', false/);
});

test('#321 integrity guard runs before the existing lifecycle scheduler', async () => {
  const sql = await read(migrationPath);
  const integrityTrigger = sql.indexOf('create trigger transfer_deal_integrity_guard');
  const lifecycleFunction = sql.indexOf('create or replace function public.schedule_transfer_deal_lifecycle');

  assert.ok(integrityTrigger >= 0);
  assert.ok(lifecycleFunction > integrityTrigger);
  assert.ok('transfer_deal_integrity_guard'.localeCompare('transfer_deal_lifecycle_schedule') < 0);
});
