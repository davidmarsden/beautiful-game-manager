import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FIXTURE_SEED_VERSION,
  legacyFixtureSeedInput,
  prepareCommittedFixtureSeed,
  revealCommittedSeed,
  verifySeedCommitment
} from '../src/matchEngine/fixtureSeed.js';

function baseContract() {
  return {
    run_key: 'world-alpha:fixture-42',
    fixture: {
      fixture_id: 'fixture-42',
      world_id: 'world-alpha',
      season_id: 'season-1',
      matchday: 7,
      kickoff_at: '2026-08-25T19:00:00.000Z'
    },
    teams: { home: {}, away: {} }
  };
}

test('#315 private nonce makes the production seed unknowable from public fixture identifiers', () => {
  const contract = baseContract();
  const predictableSeed = legacyFixtureSeedInput(contract);
  const prepared = prepareCommittedFixtureSeed({
    baseContract: contract,
    nonce: 'a'.repeat(64)
  });

  assert.equal(prepared.version, FIXTURE_SEED_VERSION);
  assert.notEqual(prepared.seed, predictableSeed);
  assert.match(prepared.commitment, /^[0-9a-f]{64}$/);
  assert.equal(verifySeedCommitment(prepared.seed, prepared.commitment), true);
  assert.equal(verifySeedCommitment(`${prepared.seed}-tampered`, prepared.commitment), false);
  assert.ok(prepared.contract.run_key.endsWith(`:seed:${'a'.repeat(64)}`));
});

test('#315 retries with the same stored nonce reproduce the exact seed and commitment', () => {
  const nonce = 'b'.repeat(64);
  const first = prepareCommittedFixtureSeed({ baseContract: baseContract(), nonce });
  const retry = prepareCommittedFixtureSeed({ baseContract: baseContract(), nonce });
  const reroll = prepareCommittedFixtureSeed({ baseContract: baseContract(), nonce: 'c'.repeat(64) });

  assert.equal(retry.seed, first.seed);
  assert.equal(retry.commitment, first.commitment);
  assert.notEqual(reroll.seed, first.seed);
  assert.notEqual(reroll.commitment, first.commitment);
});

test('#315 reveal publishes the exact seed only in the completed result model', () => {
  const prepared = prepareCommittedFixtureSeed({ baseContract: baseContract(), nonce: 'd'.repeat(64) });
  const raw = { status: 'completed', score: { home: 2, away: 1 }, model: { simulator: 'test' } };
  const revealed = revealCommittedSeed(raw, prepared);

  assert.equal(revealed.model.match_seed, prepared.seed);
  assert.equal(revealed.model.seed_commitment, prepared.commitment);
  assert.equal(revealed.model.seed_version, FIXTURE_SEED_VERSION);
  assert.equal(raw.model.match_seed, undefined);
});

test('#315 production runner persists commitment before simulation and reveal after finalisation', async () => {
  const source = await readFile(new URL('../netlify/functions/run-fixtures.mjs', import.meta.url), 'utf8');
  const commitIndex = source.indexOf('await publishSeedCommitment(fixture, preparedSeed)');
  const simulateIndex = source.indexOf('const rawResult = ENGINE_RUNNER_URL');
  const finaliseIndex = source.indexOf('const stateApplied = await persistResult');
  const revealIndex = source.indexOf('await revealFixtureSeed(fixture.id, preparedSeed)');

  assert.ok(commitIndex >= 0, 'runner must persist the commitment');
  assert.ok(simulateIndex > commitIndex, 'commitment must exist before engine resolution');
  assert.ok(finaliseIndex > simulateIndex, 'result must resolve before canonical finalisation');
  assert.ok(revealIndex > finaliseIndex, 'seed must not be revealed before successful finalisation');
  assert.match(source, /existingRun\?\.seed_nonce \|\| createSeedNonce\(\)/);
  assert.match(source, /seed commitment changed across retries/);
});

test('#315 migration keeps nonce in service-only match_runs and exposes only commitment/reveal on fixtures', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260824_pre_alpha_match_seed_commit_reveal.sql', import.meta.url), 'utf8');
  assert.match(sql, /match_runs[\s\S]*seed_nonce text/);
  assert.match(sql, /fixtures[\s\S]*match_seed_commitment text/);
  assert.match(sql, /fixtures[\s\S]*match_seed_reveal text/);
  assert.doesNotMatch(sql, /fixtures[\s\S]*seed_nonce text/);
});
