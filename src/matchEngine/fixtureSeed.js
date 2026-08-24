import { createHash, randomBytes } from 'node:crypto';

export const FIXTURE_SEED_VERSION = 'tbg-fixture-seed-v1';

const text = (value) => String(value ?? '').trim();

export function legacyFixtureSeedInput(contract = {}) {
  const fixture = contract.fixture || {};
  return [
    fixture.fixture_id || fixture.id || 'fixture',
    fixture.season_id || fixture.season || contract.season_id || '',
    fixture.round || fixture.matchday || contract.round || '',
    fixture.date || fixture.kickoff_at || fixture.scheduled_at || '',
    contract.run_key || ''
  ].join('|');
}

export function createSeedNonce(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

export function seededRunKey(baseRunKey, nonce) {
  const base = text(baseRunKey);
  const secret = text(nonce);
  if (!base) throw new Error('Fixture seed requires a base run key');
  if (!secret) throw new Error('Fixture seed requires a private nonce');
  return `${base}:seed:${secret}`;
}

export function seedCommitment(seed) {
  const value = text(seed);
  if (!value) throw new Error('Fixture seed commitment requires a seed');
  return createHash('sha256')
    .update(`${FIXTURE_SEED_VERSION}\0${value}`, 'utf8')
    .digest('hex');
}

export function prepareCommittedFixtureSeed({ baseContract, nonce }) {
  if (!baseContract || typeof baseContract !== 'object') throw new Error('Fixture seed requires an engine contract');
  const contract = {
    ...baseContract,
    run_key: seededRunKey(baseContract.run_key, nonce)
  };
  const seed = legacyFixtureSeedInput(contract);
  return Object.freeze({
    version: FIXTURE_SEED_VERSION,
    nonce: text(nonce),
    contract: Object.freeze(contract),
    seed,
    commitment: seedCommitment(seed)
  });
}

export function verifySeedCommitment(seed, commitment) {
  const expected = seedCommitment(seed);
  return expected === text(commitment).toLowerCase();
}

export function revealCommittedSeed(result, prepared) {
  if (!prepared?.seed || !prepared?.commitment) throw new Error('Cannot reveal an unprepared fixture seed');
  return {
    ...result,
    model: {
      ...(result?.model || {}),
      seed_version: prepared.version,
      seed_commitment: prepared.commitment,
      match_seed: prepared.seed
    }
  };
}
