import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('free-agent signing uses the governed pool and CAS-safe canonical settlement', async () => {
  const endpoint = await read('netlify/functions/free-agents.mjs');
  const settlement = await read('netlify/functions/_lib/free-agent-settlement.mjs');

  assert.match(endpoint, /\['GET', 'POST'\]/);
  assert.match(endpoint, /action !== 'sign'/);
  assert.match(endpoint, /isUnsignedActive\(candidate\)/);
  assert.match(endpoint, /signFreeAgent\(/);

  assert.match(settlement, /acquireFreeAgent\(world\.squad_cycle/);
  assert.match(settlement, /p_expected_checksum: before\.save_checksum/);
  assert.match(settlement, /apply_free_agent_acquisition_settlement/);
  assert.match(settlement, /buildWorldReadModel\(world\)/);
  assert.match(settlement, /reconcile\(acquisitionId, envelope\.checksum\)/);
  assert.match(settlement, /Transfermarkt ID .* already exists in the world/);
});

test('free-agent acquisition requests are idempotent and persist club-scoped terminal history', async () => {
  const migration = await read('supabase/migrations/20260819f_free_agent_live_settlement.sql');
  const checksumGuard = await read('supabase/migrations/20260819g_free_agent_settlement_checksum_guard.sql');
  const reviewHardening = await read('supabase/migrations/20260819h_free_agent_idempotency_and_history_scope.sql');
  const history = await read('netlify/functions/transfer-history.mjs');

  assert.match(migration, /create table if not exists public\.player_acquisitions/);
  assert.match(migration, /player_acquisitions_request_key_uidx/);
  assert.match(migration, /create_free_agent_acquisition_for_user/);
  assert.match(migration, /apply_free_agent_acquisition_settlement/);
  assert.match(migration, /world_read_model_cache/);
  assert.match(migration, /get_manager_player_acquisition_history_for_user/);
  assert.match(migration, /revoke all on public\.player_acquisitions from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.apply_free_agent_acquisition_settlement[\s\S]*to service_role/);

  assert.match(checksumGuard, /replacement_checksum_value/);
  assert.match(checksumGuard, /where world_id = acquisition_row\.world_id[\s\S]*save_checksum = p_expected_checksum[\s\S]*turn_status = 'open'/);

  const requestReplayIndex = reviewHardening.indexOf('request_key = p_request_key');
  const completedPlayerIndex = reviewHardening.indexOf("player_id = p_player_id and status = 'completed'");
  assert.ok(requestReplayIndex >= 0 && completedPlayerIndex > requestReplayIndex, 'request-key replay must be checked before completed-player rejection');
  assert.match(reviewHardening, /if row_value\.id is not null then[\s\S]*'accepted', true/);
  assert.match(reviewHardening, /where world_id = p_world_id[\s\S]*and club_id = club_id_value[\s\S]*and status <> 'pending'/);

  assert.match(history, /get_manager_player_acquisition_history_for_user/);
  assert.match(history, /\.sort\(\(a, b\) => historyTime\(b\) - historyTime\(a\)\)/);
});

test('explicit zero wages survive endpoint and settlement normalization', async () => {
  const endpoint = await read('netlify/functions/free-agents.mjs');
  const settlement = await read('netlify/functions/_lib/free-agent-settlement.mjs');
  assert.match(endpoint, /function normaliseNonNegativeInteger/);
  assert.match(endpoint, /wage: normaliseNonNegativeInteger\(body\.wage, 1000\)/);
  assert.doesNotMatch(endpoint, /Number\(body\.wage \?\? 1000\) \|\| 1000/);
  assert.match(settlement, /const safeWage = normaliseNonNegativeInteger\(wage, 1000\)/);
  assert.doesNotMatch(settlement, /Math\.round\(Number\(wage\) \|\| 1000\)/);
});

test('free-agent deterministic failures are terminalized while transient CAS conflicts remain retryable', async () => {
  const settlement = await read('netlify/functions/_lib/free-agent-settlement.mjs');
  assert.match(settlement, /deterministicApplicationError/);
  assert.match(settlement, /fail_free_agent_acquisition/);
  assert.match(settlement, /checkpoint_changed_or_busy/);
  assert.match(settlement, /status: 'application_failed'/);
});
