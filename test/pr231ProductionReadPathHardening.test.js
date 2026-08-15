import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260815_production_read_path_hardening.sql', import.meta.url);
const transferUiPath = new URL('../public/transfer-negotiations.js', import.meta.url);

async function migrationSource() {
  return readFile(migrationPath, 'utf8');
}

test('manager read projections are checksum cached before the canonical envelope is loaded', async () => {
  const source = await migrationSource();

  assert.match(source, /create table if not exists public\.manager_portal_fragment_cache/);
  assert.match(source, /create table if not exists public\.manager_transfer_directory_cache/);
  assert.doesNotMatch(source, /canonical_world_saves%rowtype/i, 'read RPCs must not materialize the whole canonical row');
  assert.doesNotMatch(source, /select\s+\*\s+into\s+stored/i, 'read RPCs must not SELECT * from the canonical row');

  const portalCacheLookup = source.indexOf('from public.manager_portal_fragment_cache cache');
  const portalEnvelopeLoad = source.indexOf('select save_envelope', portalCacheLookup);
  assert.ok(portalCacheLookup >= 0 && portalEnvelopeLoad > portalCacheLookup, 'portal cache must be checked before save_envelope is touched');

  const transferFunction = source.indexOf('create or replace function public.get_manager_transfer_directory_for_user');
  const transferCacheLookup = source.indexOf('from public.manager_transfer_directory_cache cache', transferFunction);
  const transferEnvelopeLoad = source.indexOf('select save_envelope', transferCacheLookup);
  assert.ok(transferCacheLookup > transferFunction && transferEnvelopeLoad > transferCacheLookup, 'transfer cache must be checked before save_envelope is touched');
  assert.match(source, /source_checksum\s*=\s*stored_checksum/g);
});

test('manager portal cache contains only the runtime data the portal consumes', async () => {
  const source = await migrationSource();
  const slimRuntime = source.slice(source.indexOf("slim_runtime := jsonb_build_object("), source.indexOf("fragment := jsonb_build_object("));

  assert.match(slimRuntime, /'fixtures'/);
  assert.match(slimRuntime, /'archive_results'/);
  assert.match(slimRuntime, /'results'/);
  assert.match(slimRuntime, /'table'/);
  assert.match(slimRuntime, /'players'/);
  assert.match(slimRuntime, /'availability'/);
  assert.doesNotMatch(slimRuntime, /'statistics'/);
  assert.doesNotMatch(slimRuntime, /'events'/);
  assert.doesNotMatch(slimRuntime, /'lineup_state'/);
  assert.match(source, /jsonb_build_object\('fixture', row\.value -> 'fixture', 'score', row\.value -> 'score'\)/);
});

test('transfer workspace deduplicates render refreshes but forces refresh after mutations', async () => {
  const source = await readFile(transferUiPath, 'utf8');

  assert.match(source, /const TRANSFER_REFRESH_TTL_MS = 60_000/);
  assert.match(source, /if \(!force && state && now - lastRefreshAt < TRANSFER_REFRESH_TTL_MS\)/);
  assert.match(source, /if \(!force && refreshPromise\) return refreshPromise/);
  assert.ok((source.match(/await refresh\(\{ force: true \}\)/g) || []).length >= 2, 'offer/listing and response mutations must bypass the cache');
  assert.match(source, /window\.addEventListener\('tbg:portal-rendered',[\s\S]*await refresh\(\)/);
});

test('read caches are service-role-only implementation details', async () => {
  const source = await migrationSource();
  assert.match(source, /revoke all on public\.manager_portal_fragment_cache from public, anon, authenticated/);
  assert.match(source, /revoke all on public\.manager_transfer_directory_cache from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.get_manager_portal_world_fragment\(text, text\) to service_role/);
  assert.match(source, /grant execute on function public\.get_manager_transfer_directory_for_user\(uuid, text\) to service_role/);
});
