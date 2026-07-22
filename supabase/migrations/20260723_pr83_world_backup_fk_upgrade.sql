-- PR #83: preserve world-scoped operational history on PR #79 upgrade paths.
--
-- Fresh PR #81 installs already create these manager references with ON DELETE SET NULL.
-- Installations that previously ran PR #79 may still have ON DELETE CASCADE constraints,
-- which would delete world-level backups or alerts when a manager profile is removed.

DO $migration$
DECLARE
  constraint_row record;
BEGIN
  IF to_regclass('public.persistent_world_backups') IS NOT NULL THEN
    ALTER TABLE public.persistent_world_backups ALTER COLUMN manager_id DROP NOT NULL;

    FOR constraint_row IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
      WHERE con.conrelid = 'public.persistent_world_backups'::regclass
        AND con.contype = 'f'
        AND att.attname = 'manager_id'
    LOOP
      EXECUTE format('ALTER TABLE public.persistent_world_backups DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;

    ALTER TABLE public.persistent_world_backups
      ADD CONSTRAINT persistent_world_backups_manager_id_fkey
      FOREIGN KEY (manager_id)
      REFERENCES public.manager_profiles(id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;

DO $migration$
DECLARE
  constraint_row record;
BEGIN
  IF to_regclass('public.world_operation_alerts') IS NOT NULL THEN
    FOR constraint_row IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
      WHERE con.conrelid = 'public.world_operation_alerts'::regclass
        AND con.contype = 'f'
        AND att.attname = 'manager_id'
    LOOP
      EXECUTE format('ALTER TABLE public.world_operation_alerts DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;

    ALTER TABLE public.world_operation_alerts
      ADD CONSTRAINT world_operation_alerts_manager_id_fkey
      FOREIGN KEY (manager_id)
      REFERENCES public.manager_profiles(id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;
