const text = (value) => String(value || '').trim();

export const CHECKPOINT_WRITE_OUTCOME = Object.freeze({
  COMMITTED: 'committed',
  NOT_COMMITTED: 'not_committed',
  CONFLICT: 'conflict',
  UNAVAILABLE: 'unavailable'
});

/**
 * Reconcile an ambiguous canonical-checkpoint write against the row that is
 * currently authoritative.
 *
 * This deliberately treats only an exact expected replacement checksum as a
 * successful commit. A third checksum is never accepted as success: it means
 * another checkpoint became authoritative and requires explicit recovery.
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
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: null,
      reason: 'Canonical checkpoint could not be read after the ambiguous write response'
    };
  }

  const canonicalWorldId = text(canonicalCheckpoint.world_id);
  const canonicalChecksum = text(canonicalCheckpoint.save_checksum);

  if (canonicalWorldId && canonicalWorldId !== expectedWorldId) {
    return {
      outcome: CHECKPOINT_WRITE_OUTCOME.CONFLICT,
      accepted: false,
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
      outcome: CHECKPOINT_WRITE_OUTCOME.NOT_COMMITTED,
      accepted: false,
      world_id: expectedWorldId,
      previous_checksum: previous,
      expected_replacement_checksum: expected,
      canonical_checksum: canonicalChecksum,
      turn_status: canonicalCheckpoint.turn_status || null,
      reason: 'Canonical checkpoint still matches the previous checksum; the replacement did not commit'
    };
  }

  return {
    outcome: CHECKPOINT_WRITE_OUTCOME.CONFLICT,
    accepted: false,
    world_id: expectedWorldId,
    previous_checksum: previous,
    expected_replacement_checksum: expected,
    canonical_checksum: canonicalChecksum || null,
    turn_status: canonicalCheckpoint.turn_status || null,
    reason: 'Canonical checkpoint matches neither the previous nor expected replacement checksum'
  };
}
