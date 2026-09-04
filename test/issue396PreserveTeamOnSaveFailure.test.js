import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('#396 snapshots the visible XI and bench before the authoritative save controller runs', async () => {
  const index = await read('public/index.html');
  const source = await read('public/team-selection-save-preservation.js');
  assert.ok(index.indexOf('team-selection-save-preservation.js') < index.indexOf('team-selection-submission-reliability.js'));
  assert.match(source, /document\.addEventListener\('submit'/);
  assert.match(source, /event\.target\?\.id !== 'decisionForm'/);
  assert.match(source, /pendingSnapshot = captureSnapshot\(\)/);
  assert.match(source, /#formationPitch \[data-zone="xi"\]\[data-index\]/);
  assert.match(source, /#formationBench \[data-zone="bench"\]\[data-index\]/);
});

test('#396 restores exactly the attempted team when save or canonical read-back fails', async () => {
  const source = await read('public/team-selection-save-preservation.js');
  assert.match(source, /status\.classList\.contains\('error'\)/);
  assert.match(source, /writeOrderedSelectors\('startingXi', 'xi', snapshot\.startingXi\)/);
  assert.match(source, /writeOrderedSelectors\('bench', 'bench', snapshot\.bench\)/);
  assert.match(source, /source: 'save_failure_restore'/);
  assert.match(source, /window\.addEventListener\('tbg:team-submission-saved'/);
  assert.match(source, /event\.detail\?\.state\?\.current_submission && !event\.detail\?\.refresh_error/);
  assert.match(source, /pendingSnapshot = null/);
});

test('#396 preserves formation, captain and tactics alongside player selection', async () => {
  const source = await read('public/team-selection-save-preservation.js');
  for (const field of ['captainId', 'formation', 'mentality', 'pressing', 'tempo', 'width', 'defensiveLine']) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /restoreControls\(snapshot\)/);
});
