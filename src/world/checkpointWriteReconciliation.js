const text = (value) => String(value || '').trim();

export const CHECKPOINT_WRITE_OUTCOME = Object.freeze({
  COMMITTED: 'committed',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  UNAVAILABLE: 'unavailable'
});

/**
 * Reconcile one authoritative read-back observation after an ambiguous
 * canonical-checkpoint write response.
 *
 * Only an exact expected replacement checksum proves that the commit
 * succeeded. Observing the previous checksum does not prove non-commit: the
 * original RPC may still be running and can become authoritative after this
 * read. Callers must keep polling within a bounded reconciliation window and
 * must not reopen submissions or mark the turn failed from a PENDING result.
 *
 * A third checksum is never accepted as success. It means another checkpoint
 * became authoritative and requires explicit recovery.
 */
export function reconcileCheckpointWrite({
  worldId,
  previousChecksum,
  expectedReplacementChecksum,
  canonicalCheckpoint
}) {
  const expectedWorldId = text(worldId);
  const previous = text(previousChecksum);
  const expected = text(expectedReplacementChecksum);

  if (!expectedWorldId) throw new Error('Checkpoint reconciliation requires a world id');
  if (!previous) throw new Error('Checkpoint reconciliation requires the previous checksum');
  if (!expected) throw new Error('Checkpoint reconciliation requires the expected replacement checksum');
  if (previous === expected) throw new Error('Previous and expected replacement checksums must differ');

  if (!canonicalCheckpoint) {
    return {
      outcome: CHECKPOINT_WRITE_OUTCOME.UNAVAILABLE,
      accepted: false,
      terminal: false,
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: null,
      reason: 'Canonical checkpoint could not be read; the write outcome remains unresolved'
    };
  }

  const canonicalWorldId = text(canonicalCheckpoint.world_id);
  const canonicalChecksum = text(canonicalCheckpoint.save_checksum);

  if (canonicalWorldId && canonicalWorldId !== expectedWorldId) {
    return {
      outcome: CHECKPOINT_WRITE_OUTCOME.CONFLICT,
      accepted: false,
      terminal: true,
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: canonicalChecksum || null,
      reason: `Checkpoint read returned world ${canonicalWorldId} instead of ${expectedWorldId}`
    };
  }

  if (canonicalChecksum === expected) {
    return {
      outcome: CHECKPOINT_WRITE_OUTCOME.COMMITTED,
      accepted: true,
      terminal: true,
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: canonicalChecksum,
      turn_status: canonicalCheckpoint.turn_status || null,
      reason: 'Canonical checkpoint matches the expected replacement checksum; the commit succeeded and only the response was lost'
    };
  }

  if (canonicalChecksum === previous) {
    return {
      outcome: CHECKPOINT_WRITE_OUTCOME.PENDING,
      accepted: false,
      terminal: false,
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: canonicalChecksum,
      turn_status: canonicalCheckpoint.turn_status || null,
      reason: 'Canonical checkpoint still matches the previous checksum, but the original write may still be in flight; continue bounded reconciliation polling'
    };
  }

  return {
    outcome: CHECKPOINT_WRITE_OUTCOME.CONFLICT,
    accepted: false,
    terminal: true,
    world_id: expectedWorldId,
    previous_checksum: previous,
    expected_replacement_checksum: expected,
    canonical_checksum: canonicalChecksum || null,
    turn_status: canonicalCheckpoint.turn_status || null,
    reason: 'Canonical checkpoint matches neither the previous nor expected replacement checksum'
  };
}
