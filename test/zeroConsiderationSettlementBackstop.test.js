import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../netlify/functions/_lib/transfer-settlement.mjs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260903c_role_independent_transfer_reciprocity.sql', import.meta.url),
  'utf8'
);

test('settlement requires exactly one two-club pair with value moving both ways', () => {
  assert.match(source, /const clubs = new Set/);
  assert.match(source, /clubs\.size !== 2/);
  assert.match(source, /hasAtoB/);
  assert.match(source, /hasBtoA/);
  assert.match(source, /Transfer settlement requires reciprocal consideration/);
});

test('settlement rejects third-club legs instead of accepting a reciprocal subset', () => {
  assert.match(source, /allWithinPair/);
  assert.match(source, /Transfer settlement contains a leg outside the participating club pair/);
});

test('reciprocity failures are terminal, not endlessly retried', () => {
  assert.match(source, /exactly one two-club pair/);
  assert.match(source, /outside the participating club pair/);
  assert.match(source, /reciprocal consideration/);
  assert.match(source, /deterministicSettlementError/);
  assert.match(source, /status: 'application_failed'/);
});

test('database reciprocity is role-independent and tied to the two deal participants', () => {
  assert.match(migration, /count\(distinct participant\.club_id\)/);
  assert.match(migration, /meaningful_clubs is distinct from participant_clubs/);
  assert.match(migration, /direction_count <> 2/);
  assert.doesNotMatch(migration, /participant\.role = 'buyer'/);
  assert.doesNotMatch(migration, /participant\.role = 'seller'/);
});

test('cleanup covers malformed deals that were already agreed or binding', () => {
  assert.match(migration, /'negotiating','agreed','grace_period','binding','settling'/);
  assert.match(migration, /status = 'application_failed'/);
  assert.match(migration, /invalid_nonreciprocal_transfer_revision/);
});
