import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const docs = fs.readFileSync(new URL('../docs/production-turn-worker.md', import.meta.url), 'utf8');

test('documents the reconciliation-required safety contract', () => {
  assert.match(docs, /reconciliation_required/);
  assert.match(docs, /must not automatically reopen submissions/);
  assert.match(docs, /short-lived HMAC/);
});
