import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('frozen failed turn plans are normalized again at execution', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');

  assert.match(source, /function normalizeExecutionInstructions\(instructionsByClub = \{\}\)/);
  assert.match(source, /normalized\.tactics = normalizePortalTactics\(normalized\.tactics\)/);
  assert.match(source, /const executionInstructions = normalizeExecutionInstructions\(plan\.instructions_by_club\)/);
  assert.match(source, /instructionsByClub: executionInstructions/);
});

test('execution normalization does not mutate the frozen checkpoint plan', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');
  const helperStart = source.indexOf('function normalizeExecutionInstructions');
  const helperEnd = source.indexOf('\n}\n\nexport function currentTurnIdentity', helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /const normalized = clone\(instruction \|\| \{\}\)/);
  assert.doesNotMatch(helper, /instruction\.tactics\s*=/);
  assert.match(source, /return Object\.freeze\(\{ version: SHARED_WORLD_SCHEDULER_VERSION, accepted: true, plan,/);
});

test('the exact frozen width value is translated before engine validation', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');

  assert.match(source, /normalized\.route_to_goal = width === 'narrow' \? 'central' : width/);
  assert.match(source, /delete normalized\.width/);
  assert.match(source, /delete normalized\.defensive_line/);
});
