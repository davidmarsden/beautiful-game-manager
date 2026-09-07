import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicApplicationError } from '../netlify/functions/_lib/free-agent-settlement.mjs';

test('free-agent wage-budget failures are terminal application errors', () => {
  assert.equal(
    deterministicApplicationError(new Error('tbg-club-057 wage budget exceeded (61000 > 31200)')),
    true
  );
});

test('checkpoint contention remains retryable rather than terminal', () => {
  assert.equal(
    deterministicApplicationError(new Error('checkpoint_changed_or_busy')),
    false
  );
});
