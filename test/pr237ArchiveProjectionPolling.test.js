import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectionNeedsEnvelope } from '../netlify/functions/refresh-match-archives.mjs';

const sourceUrl = new URL('../netlify/functions/refresh-match-archives.mjs', import.meta.url);

test('archive projection skips the expensive envelope read when archive and read model match the checksum', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 8,
    saveChecksum: 'checksum-8',
    currentArchiveRows: [{ fixture_id: 'md7-fixture' }],
    currentReadModelRows: [{ world_id: 'world-1' }]
  }), false);
});

test('projection fetches the envelope once when a new checksum needs archives and read model', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 8,
    saveChecksum: 'checksum-8',
    currentArchiveRows: [],
    currentReadModelRows: []
  }), true);
});

test('existing archives still trigger one bootstrap read when the compact read model is missing', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 8,
    saveChecksum: 'checksum-8',
    currentArchiveRows: [{ fixture_id: 'md7-fixture' }],
    currentReadModelRows: []
  }), true);
});

test('pre-match worlds fetch once to seed the read model then skip unchanged polls', () => {
  assert.equal(projectionNeedsEnvelope({
    matchday: 1,
    saveChecksum: 'preseason-checksum',
    currentArchiveRows: [],
    currentReadModelRows: []
  }), true);
  assert.equal(projectionNeedsEnvelope({
    matchday: 1,
    saveChecksum: 'preseason-checksum',
    currentArchiveRows: [],
    currentReadModelRows: [{ world_id: 'world-1' }]
  }), false);
});

test('scheduled poll keeps save_envelope out of metadata reads and checksum-guards the single expensive read', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /turn_status=eq\.open&select=world_id,save_checksum,season_id,matchday/);
  assert.doesNotMatch(source, /turn_status=eq\.open&select=world_id,save_checksum,save_envelope,season_id,matchday'\)/);
  assert.match(source, /source_checksum=eq\.\$\{encoded\(worldRow\.save_checksum\)\}/);
  assert.match(source, /world_read_model_cache\?world_id=eq\.\$\{encoded\(worldRow\.world_id\)\}&source_checksum=eq\.\$\{encoded\(worldRow\.save_checksum\)\}/);
  assert.match(source, /save_checksum=eq\.\$\{encoded\(worldRow\.save_checksum\)\}.*select=world_id,save_checksum,save_envelope,season_id,matchday/);
  assert.match(source, /world_read_model_cache\?on_conflict=world_id/);
});
