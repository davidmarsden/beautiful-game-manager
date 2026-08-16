import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectionNeedsEnvelope } from '../netlify/functions/refresh-match-archives.mjs';

const sourceUrl = new URL('../netlify/functions/refresh-match-archives.mjs', import.meta.url);

test('archive projection skips the expensive envelope read when the current checksum is already archived', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 8,
    saveChecksum: 'checksum-8',
    currentArchiveRows: [{ fixture_id: 'md7-fixture' }]
  }), false);
});

test('archive projection fetches the envelope once for a new post-matchday checksum', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 8,
    saveChecksum: 'checksum-8',
    currentArchiveRows: []
  }), true);
});

test('pre-match worlds do not repeatedly fetch a full envelope when there is nothing to archive', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 1,
    saveChecksum: 'preseason-checksum',
    currentArchiveRows: []
  }), false);
});

test('scheduled poll keeps save_envelope out of the metadata query and checksum-guards the expensive read', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /turn_status=eq\.open&select=world_id,save_checksum,season_id,matchday/);
  assert.doesNotMatch(source, /turn_status=eq\.open&select=world_id,save_checksum,save_envelope,season_id,matchday'\)/);
  assert.match(source, /source_checksum=eq\.\$\{encoded\(worldRow\.save_checksum\)\}/);
  assert.match(source, /save_checksum=eq\.\$\{encoded\(worldRow\.save_checksum\)\}.*select=world_id,save_checksum,save_envelope,season_id,matchday/);
});
