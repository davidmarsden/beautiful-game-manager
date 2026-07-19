import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runGoldStandardStressTests, teamFromSetup } from '../src/matchEngine/goldStandardStressTests.js';

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

test('managed rotation rebuilds the bench from the final overridden XI', async () => {
  const gold = await dataset();
  const squad = gold.squads.southall;
  const firstChoice = squad.setups.wide_433.starting_xi;
  const rotatedXi = firstChoice.map((id) => id === 'southall-rb' ? 'southall-fb2' : id === 'southall-lw' ? 'southall-wing2' : id);
  const team = teamFromSetup(squad, 'wide_433', { starting_xi: rotatedXi });

  assert.equal(team.starting_xi.length, 11);
  assert.equal(new Set(team.starting_xi).size, 11);
  assert.equal(team.bench.includes('southall-fb2'), false);
  assert.equal(team.bench.includes('southall-wing2'), false);
  assert.equal(team.bench.includes('southall-rb'), true);
  assert.equal(team.bench.includes('southall-lw'), true);
  assert.deepEqual(team.starting_xi.filter((id) => team.bench.includes(id)), []);
});

test('gold-standard setup rejects duplicate or unknown selections', async () => {
  const gold = await dataset();
  const squad = gold.squads.southall;
  const base = squad.setups.wide_433.starting_xi;
  assert.throws(() => teamFromSetup(squad, 'wide_433', { starting_xi: [...base.slice(0, 10), base[0]] }), /11 unique players/);
  assert.throws(() => teamFromSetup(squad, 'wide_433', { starting_xi: [...base.slice(0, 10), 'missing-player'] }), /not found in squad/);
});

test('gold-standard harness rejects an unversioned dataset', () => {
  assert.throws(() => runGoldStandardStressTests({}), /Unsupported or missing/);
});
