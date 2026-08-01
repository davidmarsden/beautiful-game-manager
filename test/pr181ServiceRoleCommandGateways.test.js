import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260801_service_role_command_gateways.sql', import.meta.url),
  'utf8'
);
const rollback = fs.readFileSync(
  new URL('../supabase/rollback/20260801_service_role_command_gateways_rollback.sql', import.meta.url),
  'utf8'
);
const sharedWorld = fs.readFileSync(
  new URL('../netlify/functions/shared-world.mjs', import.meta.url),
  'utf8'
);
const bulkRegistration = fs.readFileSync(
  new URL('../netlify/functions/bulk-squad-registration.mjs', import.meta.url),
  'utf8'
);

test('command gateways derive manager and club identity from a verified user', () => {
  assert.match(migration, /where profile\.user_id = p_user_id/i);
  assert.match(migration, /appointment\.world_id = p_world_id/i);
  assert.match(migration, /appointment\.status = 'active'/i);
  assert.match(migration, /set_config\('request\.jwt\.claim\.sub', p_user_id::text, true\)/i);
  assert.doesNotMatch(migration, /submit_manager_world_command_for_user\([\s\S]*p_manager_id/i);
  assert.doesNotMatch(migration, /submit_manager_world_command_for_user\([\s\S]*p_club_id/i);
});

test('direct authenticated command RPC execution is removed', () => {
  assert.match(migration, /revoke all on function public\.submit_manager_world_command\([\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.submit_bulk_registration_commands\([\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.submit_manager_world_command_for_user[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function public\.submit_bulk_registration_commands_for_user[\s\S]*to service_role/i);
});

test('Netlify callers use service-role gateways and verified auth user IDs', () => {
  assert.match(sharedWorld, /serverSupabase\('\/rest\/v1\/rpc\/submit_manager_world_command_for_user'/);
  assert.match(sharedWorld, /p_user_id: current\.user\.id/);
  assert.doesNotMatch(sharedWorld, /p_manager_id: current\.manager\.id/);
  assert.doesNotMatch(sharedWorld, /p_club_id: current\.appointment\.club_id/);

  assert.match(bulkRegistration, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(bulkRegistration, /serverSupabase\('\/rest\/v1\/rpc\/submit_bulk_registration_commands_for_user'/);
  assert.match(bulkRegistration, /p_user_id: current\.user\.id/);
  assert.doesNotMatch(bulkRegistration, /p_manager_id: current\.manager\.id/);
  assert.doesNotMatch(bulkRegistration, /p_club_id: current\.appointment\.club_id/);
});

test('rollback restores the previous authenticated API without public exposure', () => {
  assert.match(rollback, /grant execute on function public\.submit_manager_world_command[\s\S]*to authenticated/i);
  assert.match(rollback, /grant execute on function public\.submit_bulk_registration_commands[\s\S]*to authenticated/i);
  assert.doesNotMatch(rollback, /grant execute[\s\S]*to public/i);
});
