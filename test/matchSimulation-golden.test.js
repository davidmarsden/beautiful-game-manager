import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { simulateMatch, MATCH_ENGINE_MODES } from '../src/matchSimulation.js';
import { goldenCases, goldenWorld } from './fixtures/matchSimulation-golden-cases.js';

const goldenPath = new URL('./fixtures/matchSimulation-golden-results.json', import.meta.url);
const golden = JSON.parse(await readFile(goldenPath, 'utf8'));

function compatibilityContract(contract) {
  return { ...contract, engine_mode: MATCH_ENGINE_MODES.compatibility };
}

function normaliseResult(result) {
  const { played_at, ...deterministic } = result;
  assert.match(played_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  return deterministic;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function persistenceProjection(event, fixtureId) {
  return {
    event_id: event.event_id,
    fixture_id: fixtureId,
    event_type: event.type,
    side: event.side,
    minute: event.minute,
    player_id: event.player_id || null,
    assist_player_id: event.assist_player_id || null,
    payload: event
  };
}

test('golden fixtures protect the complete deterministic compatibility result contract', async (t) => {
  assert.deepEqual(golden.normalisation.excluded_fields, ['played_at']);

  for (const fixture of goldenCases) {
    await t.test(fixture.id, () => {
      const expected = golden.cases[fixture.id];
      assert.ok(expected, `Missing golden result for ${fixture.id}`);
      const contract = compatibilityContract(fixture.contract);

      const first = simulateMatch(contract, goldenWorld);
      const second = simulateMatch(contract, goldenWorld);
      const normalised = normaliseResult(first);

      assert.deepEqual(normalised, normaliseResult(second), 'The same run key must produce the same deterministic result');
      assert.equal(fingerprint(normalised), expected.sha256, 'Bootstrap simulator output changed; update the golden only after deliberate review');
      assert.deepEqual(first.score, expected.score);
      assert.equal(first.outcome, expected.outcome);
      assert.equal(first.events.length, expected.event_count);
    });
  }
});

test('golden compatibility output preserves the replay and report contract', () => {
  for (const fixture of goldenCases) {
    const result = simulateMatch(compatibilityContract(fixture.contract), goldenWorld);

    assert.deepEqual(Object.keys(normaliseResult(result)), [
      'result_version',
      'run_key',
      'fixture_id',
      'status',
      'score',
      'outcome',
      'events',
      'statistics',
      'model'
    ]);
    assert.equal(result.result_version, '2d5-v1');
    assert.equal(result.status, 'completed');
    assert.equal(result.fixture_id, fixture.id);
    assert.ok(Number.isInteger(result.score.home));
    assert.ok(Number.isInteger(result.score.away));
    assert.equal(result.statistics.home.possession + result.statistics.away.possession, 100);
    assert.equal(result.events.filter((event) => event.type === 'goal' && event.side === 'home').length, result.score.home);
    assert.equal(result.events.filter((event) => event.type === 'goal' && event.side === 'away').length, result.score.away);
    assert.deepEqual([...result.events].sort((a, b) => a.minute - b.minute || a.event_id.localeCompare(b.event_id)), result.events);

    for (const event of result.events) {
      assert.deepEqual(Object.keys(event), [
        'event_id',
        'type',
        'side',
        'minute',
        'player_id',
        'assist_player_id',
        'commentary'
      ]);
      assert.ok(['home', 'away', 'neutral'].includes(event.side));
      assert.ok(Number.isInteger(event.minute));
      assert.ok(event.minute >= 0 && event.minute <= 130);
      assert.equal(typeof event.commentary, 'string');
      assert.ok(event.commentary.length > 0);
    }
  }
});

test('golden compatibility events retain the current persistence mapping', () => {
  for (const fixture of goldenCases) {
    const result = simulateMatch(compatibilityContract(fixture.contract), goldenWorld);
    const rows = result.events.map((event) => persistenceProjection(event, fixture.id));

    assert.equal(rows.length, result.events.length);
    assert.deepEqual(rows.map((row) => row.event_id), result.events.map((event) => event.event_id));
    assert.ok(rows.every((row) => row.fixture_id === fixture.id));
    assert.ok(rows.every((row) => row.event_type === row.payload.type));
    assert.ok(rows.every((row) => row.side === row.payload.side));
    assert.ok(rows.every((row) => row.minute === row.payload.minute));
  }
});