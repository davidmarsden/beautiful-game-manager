import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('direct portal commands keep persistent-checkpoint guards', async () => {
  const source = await read('src/world/portalWorldControl.js');
  assert.match(source, /function checkpointAllowed\(world, context = \{\}\)/);
  assert.match(source, /context\.authoritativeCheckpoint === true \|\| safeCheckpoint\(world\)/);
  assert.match(source, /Registration changes require a persistent checkpoint/);
  assert.match(source, /Contract changes require a persistent checkpoint/);
  assert.match(source, /Transfers require a persistent checkpoint/);
  assert.match(source, /export function executePortalWorldCommand\(worldInput, command = \{\}, context = \{\}\)/);
});

test('scheduled canonical checkpoint explicitly authorizes pending manager commands', async () => {
  const worker = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  assert.match(worker, /executePortalWorldCommand\(world, command, \{ authoritativeCheckpoint: true \}\)/);
  assert.match(worker, /tracker\.begin\('apply_manager_commands'\)/);
  const commandIndex = worker.indexOf('const commandRun = applyPendingCommands(world, commands)');
  const matchIndex = worker.indexOf("tracker.begin('execute_matchday')");
  assert.ok(commandIndex >= 0 && matchIndex > commandIndex, 'manager commands must execute inside the canonical checkpoint before the matchday');
});

test('authoritative checkpoint context does not bypass football transfer validation', async () => {
  const source = await read('src/world/portalWorldControl.js');
  const transferStart = source.indexOf('export function transferPortalPlayer');
  const dispatcherStart = source.indexOf('export function executePortalWorldCommand', transferStart);
  const transfer = source.slice(transferStart, dispatcherStart);
  assert.match(transfer, /checkpointAllowed\(world, context\)/);
  assert.match(transfer, /Transfer requires another valid club/);
  assert.match(transfer, /is not owned by/);
  assert.match(transfer, /transferPlayer\(world\.squad_cycle/);
  assert.doesNotMatch(transfer, /authoritativeCheckpoint[^\n]*return/);
});

test('request history distinguishes accepted application failure from manager decline', async () => {
  const source = await read('public/world-controls.js');
  assert.match(source, /accepted_application_failed'\) return 'application failed'/);
  assert.match(source, /accepted_applied'\) return 'accepted'/);
  assert.match(source, /negotiation_state === 'declined'\) return 'declined'/);
  assert.match(source, /const statusLabel = commandStatusLabel\(command\)/);
});
