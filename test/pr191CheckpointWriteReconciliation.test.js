import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKPOINT_WRITE_OUTCOME,
  reconcileCheckpointWrite
} from '../src/world/checkpointWriteReconciliation.js';

const input = (canonicalCheckpoint) => ({
  worldId: 'world-alpha',
  previousChecksum: 'checksum-before',
  expectedReplacementChecksum: 'checksum-after',
  canonicalCheckpoint
});

test('accepts an ambiguous write only when the canonical row has the exact expected replacement checksum', () => {
  const result = reconcileCheckpointWrite(input({
    world_id: 'world-alpha',
    save_checksum: 'checksum-after',
    turn_status: 'open'
  }));

  assert.equal(result.outcome, CHECKPOINT_WRITE_OUTCOME.COMMITTED);
  assert.equal(result.accepted, true);
  assert.equal(result.canonical_checksum, 'checksum-after');
  assert.match(result.reason, /response was lost/);
});

test('reports a genuine non-commit when the canonical row still has the previous checksum', () => {
  const result = reconcileCheckpointWrite(input({
    world_id: 'world-alpha',
    save_checksum: 'checksum-before',
    turn_status: 'locking'
  }));

  assert.equal(result.outcome, CHECKPOINT_WRITE_OUTCOME.NOT_COMMITTED);
  assert.equal(result.accepted, false);
  assert.equal(result.canonical_checksum, 'checksum-before');
});

test('never treats an unrelated third checksum as a successful commit', () => {
  const result = reconcileCheckpointWrite(input({
    world_id: 'world-alpha',
    save_checksum: 'checksum-from-another-operation',
    turn_status: 'open'
  }));

  assert.equal(result.outcome, CHECKPOINT_WRITE_OUTCOME.CONFLICT);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /neither the previous nor expected replacement checksum/);
});

test('does not guess when the canonical checkpoint cannot be read', () => {
  const result = reconcileCheckpointWrite(input(null));

  assert.equal(result.outcome, CHECKPOINT_WRITE_OUTCOME.UNAVAILABLE);
  assert.equal(result.accepted, false);
  assert.equal(result.canonical_checksum, null);
});

test('rejects a checkpoint row belonging to another world', () => {
  const result = reconcileCheckpointWrite(input({
    world_id: 'world-beta',
    save_checksum: 'checksum-after',
    turn_status: 'open'
  }));

  assert.equal(result.outcome, CHECKPOINT_WRITE_OUTCOME.CONFLICT);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /world-beta/);
});

test('requires distinct previous and replacement checksums', () => {
  assert.throws(() => reconcileCheckpointWrite({
    worldId: 'world-alpha',
    previousChecksum: 'same-checksum',
    expectedReplacementChecksum: 'same-checksum',
    canonicalCheckpoint: null
  }), /must differ/);
});
