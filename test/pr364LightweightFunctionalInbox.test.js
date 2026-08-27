import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync(new URL('../public/functional-inbox.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/inbox.mjs', import.meta.url), 'utf8');

test('functional inbox refresh uses the dedicated inbox endpoint instead of full portal bootstrap', () => {
  assert.match(client, /fetch\('\/api\/inbox'/);
  assert.doesNotMatch(client, /fetch\('\/api\/bootstrap'/);
});

test('inbox endpoint supports lightweight authenticated reads and preserves canonical message filtering', () => {
  assert.match(endpoint, /\['GET', 'PATCH'\]\.includes\(request\.method\)/);
  assert.match(endpoint, /canonical_world_saves\?world_id=eq\./);
  assert.match(endpoint, /select=save_checksum,created_at&limit=1/);
  assert.match(endpoint, /manager_portal_fragment_cache\?world_id=eq\./);
  assert.match(endpoint, /source_checksum=eq\./);
  assert.match(endpoint, /function canonicalFixtureIds/);
  assert.match(endpoint, /matchday_cycle\?\.runtimes/);
  assert.match(endpoint, /function filterCurrentMessages/);
  assert.match(endpoint, /related_fixture_id/);
  assert.match(endpoint, /Date\.parse\(canonicalCreatedAt \|\| 0\)/);
  assert.doesNotMatch(endpoint, /\/rest\/v1\/fixtures\?world_id=eq\./);
});

test('lightweight inbox read never loads or projects the canonical world payload', () => {
  assert.doesNotMatch(endpoint, /save_envelope/);
  assert.doesNotMatch(endpoint, /get_manager_portal_world_fragment/);
  assert.doesNotMatch(endpoint, /projectManagerPortal/);
});
