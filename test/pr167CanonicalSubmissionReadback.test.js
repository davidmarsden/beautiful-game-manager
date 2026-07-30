import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stale in-flight bootstrap responses cannot repopulate an invalidated cache', async () => {
  const source = await read('public/portal-state-cache.js');
  assert.match(source, /let bootstrapGeneration = 0/);
  assert.match(source, /bootstrapGeneration \+= 1/);
  assert.match(source, /fetchBootstrapSnapshot\(input, init, generation\)/);
  assert.match(source, /response\.ok && generation === bootstrapGeneration/);
  assert.match(source, /bootstrapRequest\.generation !== generation/);
  assert.match(source, /if \(bootstrapRequest === activeRequest\) bootstrapRequest = null/);
});

test('team saves invalidate all local canonical state before read-back', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /window\.tbgInvalidateBootstrapCache\?\.\(\)/);
  assert.match(source, /async function refreshCanonicalState\(\)/);
  assert.match(source, /invalidatePortalState\(\);\s*const refreshed = await bootstrapState\(\)/s);
  assert.doesNotMatch(source, /response\.clone\(\)\.json\(\)/);
});

test('save success and ambiguous timeout recovery compare the exact canonical team', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /function canonicalMatchesPayload\(state, payload\)/);
  assert.match(source, /sameIds\(submission\.starting_xi, payload\.starting_xi\)/);
  assert.match(source, /sameIds\(submission\.bench, payload\.bench\)/);
  assert.match(source, /submission\.captain_id/);
  assert.match(source, /\['mentality', 'pressing', 'tempo', 'width', 'defensive_line'\]/);
  assert.match(source, /ambiguousSaveFailure/);
  assert.match(source, /confirmed after timeout/);
  assert.match(source, /Canonical read-back did not match the team just submitted/);
});
