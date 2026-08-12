import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('failed-world diagnostics are protected and bound to the unchanged checkpoint', async () => {
  const api = await read('netlify/functions/world-failure-diagnostics.mjs');
  assert.match(api, /Administrator access required/);
  assert.match(api, /turn_status !== 'failed'/);
  assert.match(api, /previous_checksum=eq\.\$\{encodeURIComponent\(world\.save_checksum\)\}/);
  assert.match(api, /world_turn_runs[\s\S]*status=eq\.failed/);
  assert.match(api, /failed_run_id/);
  assert.match(api, /operation_id/);
  assert.match(api, /error_message/);
  assert.match(api, /can_retry: Boolean\(failedRun\)/);
  assert.match(api, /cache-control': 'no-store'/);
});

test('automatic scheduler failures persist an authoritative rejected advance incident', async () => {
  const scheduler = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  assert.match(scheduler, /persistAutomaticFailure/);
  assert.match(scheduler, /scheduled-turn-failure:/);
  assert.match(scheduler, /operation_type: 'advance'/);
  assert.match(scheduler, /status: 'rejected'/);
  assert.match(scheduler, /action: 'automatic_scheduled_turn'/);
  assert.match(scheduler, /failed_run_id: runId/);
  assert.match(scheduler, /error: error\.message/);
  assert.match(scheduler, /diagnostics: diagnostics \|\| null/);
  assert.match(scheduler, /failing_stage: stageSnapshot\.stage/);
  assert.match(scheduler, /stage_elapsed_ms: stageSnapshot\.stage_elapsed_ms/);
  assert.match(scheduler, /stage_timings: stageSnapshot\.stage_timings/);
  assert.match(scheduler, /persistAutomaticFailure\(\{[\s\S]*stageSnapshot[\s\S]*\}\)/);
  assert.match(scheduler, /operation_id: operationId/);
  assert.match(scheduler, /tbg-scheduled-world-turn-v1\.9/);
});

test('admin world control explains failures and never destroys the result with an automatic reload', async () => {
  const script = await read('public/admin-turn-control.js');
  assert.match(script, /world-failure-diagnostics/);
  assert.match(script, /Matchday \$\{escapeHtml\(details\.matchday/);
  assert.match(script, /Failed run \$\{details\.failed_run_id\}/);
  assert.match(script, /Operation \$\{details\.operation_id\}/);
  assert.match(script, /Retry failed turn/);
  assert.match(script, /Manual recovery required/);
  assert.match(script, /Reopening the failed checkpoint and retrying the production scheduler/);
  assert.match(script, /Production turn response was interrupted/);
  assert.match(script, /HTTP \$\{response\.status\}/);
  assert.match(script, /showReloadAction\('Reload completed world'\)/);
  assert.match(script, /id="reloadWorldState"/);
  assert.match(script, /reloadWorldState'\)\.addEventListener\('click', \(\) => window\.location\.reload\(\)\)/);
  assert.doesNotMatch(script, /setTimeout\([\s\S]*window\.location\.reload/);
  assert.doesNotMatch(script, /window\.location\.reload\(\);[\s\S]*tbg:canonical-turn-complete/);
});

test('successful retry clears stale failed-world controls until the administrator reloads', async () => {
  const script = await read('public/admin-turn-control.js');
  assert.match(script, /function clearRecoveredFailureState\(\)/);
  assert.match(script, /failureDiagnostics = \{ active: false, can_retry: false \}/);
  assert.match(script, /panel\.innerHTML = ''/);
  assert.match(script, /button\.textContent = 'Turn complete — reload world'/);
  assert.match(script, /turnCompleted = true;[\s\S]*clearRecoveredFailureState\(\)/);
  assert.match(script, /if \(!turnCompleted\) button\.disabled/);
});

test('existing production retry remains checksum and failed-run guarded', async () => {
  const api = await read('netlify/functions/run-due-turn-now.mjs');
  assert.match(api, /before\.turn_status === 'failed'/);
  assert.match(api, /previous_checksum=eq\.\$\{encodeURIComponent\(before\.save_checksum\)\}/);
  assert.match(api, /status=eq\.failed/);
  assert.match(api, /retry_failed_turn/);
  assert.match(api, /save_checksum=eq\.\$\{encodeURIComponent\(before\.save_checksum\)\}[\s\S]*turn_status=eq\.failed/);
  assert.match(api, /Failed world changed before retry; replay rejected/);
});