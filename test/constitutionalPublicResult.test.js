import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, MATCH_ENGINE_MODES } from '../src/matchSimulation.js';
import { goldenCases, goldenWorld } from './fixtures/matchSimulation-golden-cases.js';

function constitutionalContract(source, runKey = 'constitutional:public-adapter') {
  return {
    ...source,
    run_key: runKey,
    engine_mode: MATCH_ENGINE_MODES.constitutional
  };
}

test('constitutional mode preserves the public 2d5-v1 envelope', () => {
  const result = simulateMatch(constitutionalContract(goldenCases[0].contract), goldenWorld);

  assert.equal(result.result_version, '2d5-v1');
  assert.equal(result.status, 'completed');
  assert.equal(result.fixture_id, goldenCases[0].contract.fixture.fixture_id);
  assert.equal(result.played_at, goldenCases[0].contract.fixture.kickoff_at);
  assert.ok(Number.isInteger(result.score.home));
  assert.ok(Number.isInteger(result.score.away));
  assert.equal(result.events.filter((event) => event.type === 'goal' && event.side === 'home').length, result.score.home);
  assert.equal(result.events.filter((event) => event.type === 'goal' && event.side === 'away').length, result.score.away);
  assert.equal(result.statistics.home.possession + result.statistics.away.possession, 100);
  assert.equal(result.model.simulator, 'tbg-constitutional-engine-a-f');
  assert.equal(result.model.calibrated_profile, 'pr39-baseline-v0.1');
  assert.ok(result.report.headline);
  assert.ok(result.report.summary);
});

test('constitutional public results are deterministic for the same fixture inputs', () => {
  const contract = constitutionalContract(goldenCases[1].contract, 'constitutional:repeatable');
  const first = simulateMatch(contract, goldenWorld);
  const second = simulateMatch(contract, goldenWorld);

  assert.deepEqual(first.score, second.score);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.statistics, second.statistics);
  assert.deepEqual(first.report, second.report);
  assert.equal(first.model.seed_commitment, second.model.seed_commitment);
});

test('constitutional mode is the default after cutover', () => {
  const result = simulateMatch(goldenCases[0].contract, goldenWorld);
  assert.equal(result.model.simulator, 'tbg-constitutional-engine-a-f');
});
