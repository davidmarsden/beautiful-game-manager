import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../netlify/functions/_lib/transfer-settlement.mjs', import.meta.url),
  'utf8'
);

test('settlement rejects deals without reciprocal consideration', () => {
  assert.match(source, /const directions = new Set/);
  assert.match(source, /directions\.has\(`\$\{toClubId\}->\$\{fromClubId\}`\)/);
  assert.match(source, /Transfer settlement requires reciprocal consideration/);
});

test('reciprocal-consideration failure is terminal, not endlessly retried', () => {
  assert.match(source, /reciprocal consideration/);
  assert.match(source, /deterministicSettlementError/);
  assert.match(source, /status: 'application_failed'/);
});
