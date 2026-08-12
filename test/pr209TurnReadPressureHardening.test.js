import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turn discovery and claim stay metadata-only before one explicit envelope load', async () => {
  const source = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  assert.match(source, /const fields = 'world_id,save_checksum,season_id,season_number,phase,matchday,next_turn_at,turn_status,updated_at'/);
  assert.match(source, /next_turn_at=lte\.\$\{encodeURIComponent\(now\)\}&select=\$\{fields\}/);
  assert.doesNotMatch(source, /next_turn_at=lte\.\$\{encodeURIComponent\(now\)\}&select=\*/);

  assert.match(source, /const claimFields = 'world_id,save_checksum,updated_at,turn_status'/);
  assert.match(source, /turn_status=eq\.open&select=\$\{claimFields\}/);
  assert.doesNotMatch(source, /turn_status=eq\.open[^`]*select=.*save_envelope/);
  assert.match(source, /headers: \{ prefer: 'return=representation' \}/);
  assert.match(source, /if \(lockRows\.length !== 1\) return \{ world_id: worldId, status: 'skipped'/);
  assert.match(source, /claimed = true/);

  const claimIndex = source.indexOf('const lockRows = await service');
  const envelopeReadIndex = source.indexOf('select=save_envelope', claimIndex);
  const worldLoadIndex = source.indexOf('loadPersistentWorld(JSON.stringify(envelopeRow.save_envelope))', envelopeReadIndex);
  assert.ok(claimIndex >= 0 && envelopeReadIndex > claimIndex, 'full envelope must be loaded only after the compact claim succeeds');
  assert.ok(worldLoadIndex > envelopeReadIndex, 'world deserialisation must use the explicit post-lock envelope read');
  assert.equal((source.match(/select=save_envelope/g) || []).length, 1);
  assert.match(source, /const commandDisplayWorld = world/);
});

test('shared world GET short-circuits locking worlds before the heavyweight portal fragment', async () => {
  const source = await read('netlify/functions/shared-world.mjs');
  assert.match(source, /readCanonicalState/);
  assert.match(source, /request\.method === 'GET' && state\.turn_status === 'locking'/);
  const lockGuard = source.indexOf("request.method === 'GET' && state.turn_status === 'locking'");
  const fragmentRead = source.indexOf('const context = await readCanonicalFragment(current)');
  assert.ok(lockGuard >= 0 && fragmentRead > lockGuard, 'locking GET must return before the world-fragment RPC');
  assert.match(source, /processing: true/);
});

test('shared world POST rechecks the fragment status after the heavyweight read', async () => {
  const source = await read('netlify/functions/shared-world.mjs');
  const fragmentRead = source.indexOf('const context = await readCanonicalFragment(current)');
  const recheck = source.indexOf("request.method === 'POST' && context.turn_status !== 'open'", fragmentRead);
  const bodyRead = source.indexOf('const body = await request.json()', fragmentRead);
  assert.ok(fragmentRead >= 0 && recheck > fragmentRead, 'POST must recheck the newer fragment status');
  assert.ok(bodyRead > recheck, 'turn status must be rechecked before accepting a write payload');
});

test('transfer GET checks turn status before compact JSONB directory projection', async () => {
  const source = await read('netlify/functions/transfer-negotiations.mjs');
  const stateRead = source.indexOf('const stored = await readTurnState');
  const lockGuard = source.indexOf("stored.turn_status === 'locking'");
  const directoryRead = source.indexOf('        readTransferDirectory(current),', lockGuard);
  assert.ok(stateRead >= 0 && lockGuard > stateRead, 'turn state must be read before the locking guard');
  assert.ok(directoryRead > lockGuard, 'locking GET must return before transfer directory projection');
  assert.match(source, /directory: \{ clubs: \[\], players: \[\] \}/);
});

test('shared-world command request key retains effective matchday identity', async () => {
  const source = await read('netlify/functions/shared-world.mjs');
  assert.match(source, /effective_season_id: seasonId,\s*effective_matchday: matchday/);
});
