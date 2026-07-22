import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260723_pr83_world_backup_fk_upgrade.sql', import.meta.url),
  'utf8'
);

test('PR79 upgrade preserves world backup history when a manager profile is deleted', () => {
  assert.match(migration, /persistent_world_backups[\s\S]*manager_id[\s\S]*ON DELETE SET NULL/i);
  assert.doesNotMatch(migration, /persistent_world_backups[\s\S]*manager_id[\s\S]*ON DELETE CASCADE/i);
});

test('legacy manager foreign keys are replaced rather than merely made nullable', () => {
  assert.match(migration, /pg_constraint/);
  assert.match(migration, /DROP CONSTRAINT/);
  assert.match(migration, /persistent_world_backups_manager_id_fkey/);
  assert.match(migration, /world_operation_alerts_manager_id_fkey/);
});
