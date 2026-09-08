import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('global search reads the canonical world and includes clubs plus all squad-cycle players', async () => {
  const source = await read('../netlify/functions/global-search.mjs');
  assert.match(source, /world_read_model_cache/);
  assert.match(source, /canonical_world_saves/);
  assert.match(source, /readRow\.source_checksum !== canonicalRow\.save_checksum/);
  assert.match(source, /Object\.entries\(clubProfiles\)/);
  assert.match(source, /Object\.entries\(world\.squad_cycle\?\.players \|\| \{\}\)/);
  assert.match(source, /type: 'player'/);
  assert.match(source, /type: 'club'/);
});

test('global player results use live portal condition, contracts and governed Pink Final identity', async () => {
  const source = await read('../netlify/functions/global-search.mjs');
  assert.match(source, /import \{ projectManagerPortal \}/);
  assert.match(source, /import \{ projectHistoryPlayerIdentity \}/);
  assert.match(source, /projectManagerPortal\(world, clubId\)/);
  assert.match(source, /contractFor\(world, rawPlayer\)/);
  assert.match(source, /projectHistoryPlayerIdentity\(playerId/);
  assert.match(source, /profile_url: governed\.pink_final_profile_url \|\| null/);
  assert.match(source, /pink_final_profile_url: governed\.pink_final_profile_url \|\| null/);
  assert.doesNotMatch(source, /pink_final_profile_url: player\.pink_final_profile_url \|\| player\.profile_url/);
});

test('global search rejects queries whose searchable normalization is empty', async () => {
  const source = await read('../netlify/functions/global-search.mjs');
  assert.match(source, /if \(!q\) return 0/);
  assert.match(source, /query\.length < 2 \|\| !norm\(query\)/);
});

test('manager portal exposes an accessible player and club search that opens native profiles', async () => {
  const search = await read('../public/global-search.js');
  const links = await read('../public/internal-profile-links.js');
  assert.match(search, /Search players and clubs/);
  assert.match(search, /aria-autocomplete="list"/);
  assert.match(search, /\/api\/global-search\?q=/);
  assert.match(search, /openTbgPlayerProfile\(document\.body, result\.player/);
  assert.match(search, /openClubInspection\(result\.id\)/);
  assert.match(search, /ArrowDown/);
  assert.match(search, /ArrowUp/);
  assert.match(search, /event\.key === 'Escape'/);
  assert.match(links, /import '\.\/global-search\.js'/);
  assert.match(links, /globalPlayerMatch/);
  assert.match(links, /\[data-player-profile-id\]/);
});

test('global search remains scoped to authenticated managers and does not accept world ids from the client', async () => {
  const source = await read('../netlify/functions/global-search.mjs');
  assert.match(source, /Authentication required/);
  assert.match(source, /manager_appointments/);
  assert.match(source, /appointment\.world_id/);
  assert.doesNotMatch(source, /searchParams\.get\(['"]world/);
});
