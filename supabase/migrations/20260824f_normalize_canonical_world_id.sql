begin;

-- The running game world is tbg-world-1: it owns the canonical save,
-- read model, fixtures, standings, transfers, feed and manager portal state.
-- An old bootstrap path left the 80 club catalogue rows attached to the
-- near-identical tbg-world-001 row. Alpha claiming exposed that split.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_world_saves WHERE world_id = 'tbg-world-1'
  ) THEN
    RAISE EXCEPTION 'canonical world tbg-world-1 is missing its authoritative save';
  END IF;
END
$$;

-- Refuse to move accidental alpha appointments if doing so would create an
-- active manager/club collision in the canonical world. This keeps the repair
-- atomic instead of silently dropping or overwriting an appointment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.manager_appointments legacy
    JOIN public.manager_appointments canonical
      ON canonical.world_id = 'tbg-world-1'
     AND canonical.status = 'active'
     AND legacy.status = 'active'
     AND (
       canonical.manager_id = legacy.manager_id
       OR canonical.club_id = legacy.club_id
     )
    WHERE legacy.world_id = 'tbg-world-001'
  ) THEN
    RAISE EXCEPTION 'cannot reconcile tbg-world-001 appointments: active canonical collision exists';
  END IF;
END
$$;

-- Put the shared 80-club catalogue on the same world as the authoritative
-- runtime state. Club ids are globally stable, so appointment/history foreign
-- keys remain unchanged.
UPDATE public.clubs
SET world_id = 'tbg-world-1'
WHERE world_id = 'tbg-world-001';

-- Preserve every alpha-test appointment and event, including ended history,
-- but attach it to the actual running world.
UPDATE public.manager_appointments
SET world_id = 'tbg-world-1'
WHERE world_id = 'tbg-world-001';

UPDATE public.alpha_appointment_events
SET world_id = 'tbg-world-1'
WHERE world_id = 'tbg-world-001';

-- If an alpha invitation exists in both ids, retain the canonical row and fold
-- any claim made while the alpha functions pointed at the alias into it. Email
-- delivery metadata is a single attempt-state tuple: whichever row has the
-- latest delivery attempt contributes all four fields together so message/error
-- state cannot be mismatched or lost when the duplicate is deleted.
UPDATE public.alpha_tester_invites canonical
SET status = CASE WHEN legacy.status = 'claimed' THEN 'claimed' ELSE canonical.status END,
    allowed_club_ids = CASE
      WHEN cardinality(canonical.allowed_club_ids) > 0 THEN canonical.allowed_club_ids
      ELSE legacy.allowed_club_ids
    END,
    claimed_manager_id = CASE WHEN legacy.status = 'claimed' THEN legacy.claimed_manager_id ELSE canonical.claimed_manager_id END,
    claimed_club_id = CASE WHEN legacy.status = 'claimed' THEN legacy.claimed_club_id ELSE canonical.claimed_club_id END,
    claimed_at = CASE WHEN legacy.status = 'claimed' THEN legacy.claimed_at ELSE canonical.claimed_at END,
    email_last_attempt_at = CASE
      WHEN legacy.email_last_attempt_at IS NOT NULL
       AND (canonical.email_last_attempt_at IS NULL OR legacy.email_last_attempt_at > canonical.email_last_attempt_at)
      THEN legacy.email_last_attempt_at ELSE canonical.email_last_attempt_at END,
    email_sent_at = CASE
      WHEN legacy.email_last_attempt_at IS NOT NULL
       AND (canonical.email_last_attempt_at IS NULL OR legacy.email_last_attempt_at > canonical.email_last_attempt_at)
      THEN legacy.email_sent_at ELSE canonical.email_sent_at END,
    email_message_id = CASE
      WHEN legacy.email_last_attempt_at IS NOT NULL
       AND (canonical.email_last_attempt_at IS NULL OR legacy.email_last_attempt_at > canonical.email_last_attempt_at)
      THEN legacy.email_message_id ELSE canonical.email_message_id END,
    email_last_error = CASE
      WHEN legacy.email_last_attempt_at IS NOT NULL
       AND (canonical.email_last_attempt_at IS NULL OR legacy.email_last_attempt_at > canonical.email_last_attempt_at)
      THEN legacy.email_last_error ELSE canonical.email_last_error END,
    updated_at = now()
FROM public.alpha_tester_invites legacy
WHERE canonical.world_id = 'tbg-world-1'
  AND legacy.world_id = 'tbg-world-001'
  AND lower(canonical.email) = lower(legacy.email);

DELETE FROM public.alpha_tester_invites legacy
WHERE legacy.world_id = 'tbg-world-001'
  AND EXISTS (
    SELECT 1
    FROM public.alpha_tester_invites canonical
    WHERE canonical.world_id = 'tbg-world-1'
      AND lower(canonical.email) = lower(legacy.email)
  );

-- Any non-duplicate alias invitation can now move directly.
UPDATE public.alpha_tester_invites
SET world_id = 'tbg-world-1', updated_at = now()
WHERE world_id = 'tbg-world-001';

-- Keep the alias world row for historical migration compatibility, but make
-- sure no live club/appointment/alpha state remains attached to it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clubs WHERE world_id = 'tbg-world-001')
     OR EXISTS (SELECT 1 FROM public.manager_appointments WHERE world_id = 'tbg-world-001')
     OR EXISTS (SELECT 1 FROM public.alpha_tester_invites WHERE world_id = 'tbg-world-001')
     OR EXISTS (SELECT 1 FROM public.alpha_appointment_events WHERE world_id = 'tbg-world-001') THEN
    RAISE EXCEPTION 'world-id reconciliation incomplete';
  END IF;
END
$$;

commit;
