import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turn discovery reads metadata only and gets the envelope from the atomic claim', async () => {
  const source = await read('netlify/internal/scheduled-world-turn-worker.mjs');
  assert.match(source, /const fields = 'world_id,save_checksum,season_id,season_number,phase,matchday,next_turn_at,turn_status,updated_at'/);
  assert.match(source, /next_turn_at=lte\.\$\{encodeURIComponent\(now\)\}&select=\$\{fields\}/);
  assert.doesNotMatch(source, /next_turn_at=lte\.\$\{encodeURIComponent\(now\)\}&select=\*/);
  assert.match(source, /headers: \{ prefer: 'return=representation' \}/);
  assert.match(source, /stored = lockRows\[0\]/);
  assert.equal((source.match(/loadPersistentWorld\(JSON\.stringify\(stored\.save_envelope\)\)/g) || []).length, 1);
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

test('transfer GET checks turn status before compact JSONB directory projection', async () => {
  const source = await read('netlify/functions/transfer-negotiations.mjs');
  const stateRead = source.indexOf('const stored = await readTurnState');
  const lockGuard = source.indexOf("stored.turn_status === 'locking'");
  const directoryRead = source.indexOf('readTransferDirectory(current)');
  assert.ok(stateRead >= 0 && lockGuard > stateRead, 'turn state must be read before the locking guard');
  assert.ok(directoryRead > lockGuard, 'locking GET must return before transfer directory projection');
  assert.match(source, /directory: \{ clubs: \[\], players: \[\] \}/);
});

test('shared-world command request key retains effective matchday identity', async () => {
  const source = await read('netlify/functions/shared-world.mjs');
  assert.match(source, /effective_season_id: seasonId,\s*effective_matchday: matchday/);
});
