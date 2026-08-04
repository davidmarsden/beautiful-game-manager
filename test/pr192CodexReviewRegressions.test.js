import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('run ledger permits reconciliation_required as an explicit terminal review state', async () => {
  const migration = await source('supabase/migrations/20260804_pr192_reconciliation_required_turn_status.sql');
  assert.match(migration, /alter table public\.world_turn_runs/);
  assert.match(migration, /drop constraint/);
  assert.match(migration, /'reconciliation_required'/);
});

test('administrator recovery refuses to dispatch when reconciliation is already required', async () => {
  const recovery = await source('public/admin-turn-background-recovery.js');
  const baselineGuard = recovery.indexOf("if (baseline.state === 'reconciliation_required')");
  const dispatch = recovery.indexOf("fetch('/api/run-due-turn-now-background'");
  assert.ok(baselineGuard >= 0, 'baseline reconciliation guard must exist');
  assert.ok(dispatch > baselineGuard, 'guard must execute before background dispatch');
  assert.match(recovery, /button\.textContent = 'Recovery review required'/);
  assert.match(recovery, /output\.textContent = statusText\(baseline\)/);
  assert.match(recovery, /return;/);
});
