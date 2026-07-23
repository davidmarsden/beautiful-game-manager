import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const functionSource = await readFile(new URL('../netlify/functions/initialize-canonical-world.mjs', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../supabase/migrations/20260723_pr92_canonical_initializer_timeout.sql', import.meta.url), 'utf8');

test('initializer sends only one copy of the canonical save envelope', () => {
  assert.match(functionSource, /p_save:\s*stored/);
  assert.match(functionSource, /p_backup:\s*backupMetadata\(backup\)/);
  assert.doesNotMatch(functionSource, /p_backup:\s*\{\s*\.\.\.backup/);
  const metadataBody = functionSource.slice(functionSource.indexOf('function backupMetadata'), functionSource.indexOf('export default'));
  assert.doesNotMatch(metadataBody, /save_envelope/);
});

test('opening backup is copied from the inserted canonical row inside the transaction', () => {
  assert.match(migrationSource, /insert into public\.persistent_world_backups/);
  assert.match(migrationSource, /c\.save_envelope/);
  assert.match(migrationSource, /from public\.canonical_world_saves c/);
  assert.match(migrationSource, /where c\.world_id = v_world_id/);
});

test('one-time large initialization receives a bounded extended statement timeout', () => {
  assert.match(migrationSource, /set statement_timeout = '60s'/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /grant execute on function public\.initialize_canonical_world\(jsonb, jsonb, jsonb\) to service_role/);
});

test('initializer response does not echo the multi-megabyte save envelope', () => {
  const responseBlock = functionSource.slice(functionSource.lastIndexOf('return json({'));
  assert.doesNotMatch(responseBlock, /save_envelope/);
});
