import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runGoldStandardStressTests } from '../src/matchEngine/goldStandardStressTests.js';

async function dataset() {
  const url = new URL('../calibration/gold-standard/match-engine-v1.json', import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('gold-standard dataset is versioned and records all three constitutional stress tests', async () => {
  const gold = await dataset();
  assert.equal(gold.dataset_version, 'tbg-match-engine-gold-standard-v1.0');
  assert.deepEqual(Object.keys(gold.stress_tests), ['st1', 'st2', 'st3']);
  assert.ok(gold.squads.southall.players.length >= 16);
  assert.ok(gold.squads.northfield.players.length >= 13);
});

test('Stress Tests 1-3 pass against the executable constitutional engine modules', async () => {
  const report = runGoldStandardStressTests(await dataset());
  assert.equal(report.accepted, true, JSON.stringify(report, null, 2));
  assert.equal(report.tests.length, 3);
  for (const row of report.tests) {
    assert.equal(row.accepted, true, `${row.id} failed: ${JSON.stringify(row, null, 2)}`);
    assert.equal(Object.values(row.checks).every(Boolean), true);
  }
});

test('gold-standard harness rejects an unversioned dataset', () => {
  assert.throws(() => runGoldStandardStressTests({}), /Unsupported or missing/);
});
