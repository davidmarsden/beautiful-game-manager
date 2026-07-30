import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('bootstrap flattens persisted instruction fields for saved-team reloads', async () => {
  const source = await read('netlify/functions/bootstrap.mjs');
  assert.match(source, /function normalizeCurrentSubmission\(row\)/);
  assert.match(source, /const instruction = row\.instruction/);
  assert.match(source, /starting_xi: Array\.isArray\(instruction\.starting_xi\)/);
  assert.match(source, /bench: Array\.isArray\(instruction\.bench\)/);
  assert.match(source, /formation: instruction\.formation \|\| null/);
  assert.match(source, /captain_id: instruction\.captain_id \|\| null/);
  assert.match(source, /tactics: instruction\.tactics \|\| \{\}/);
  assert.match(source, /current_submission: normalizeCurrentSubmission\(turnSubmissionRows\[0\]\)/);
});

test('concurrent bootstrap callers receive the same real response snapshot', async () => {
  const source = await read('public/portal-state-cache.js');
  assert.match(source, /async function fetchBootstrapSnapshot/);
  assert.match(source, /body: await response\.text\(\)/);
  assert.match(source, /status: response\.status/);
  assert.match(source, /if \(response\.ok\) bootstrapSnapshot = snapshot/);
  assert.match(source, /const snapshot = await bootstrapPromise/);
  assert.match(source, /return responseFromSnapshot\(snapshot\)/);
  assert.doesNotMatch(source, /await bootstrapPromise;\s*return cachedResponse\(\)/s);
  assert.doesNotMatch(source, /new Response\(null/);
});
