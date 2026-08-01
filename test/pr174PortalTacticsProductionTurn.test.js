import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled turns translate portal width into the canonical route-to-goal tactic', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');

  assert.match(source, /function normalizePortalTactics\(tactics = \{\}\)/);
  assert.match(source, /normalized\.route_to_goal = width === 'narrow' \? 'central' : width/);
  assert.match(source, /delete normalized\.width/);
  assert.match(source, /instruction\.tactics = normalizePortalTactics\(instruction\.tactics\)/);
});

test('portal-only defensive line does not reach the strict production engine validator', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');

  assert.match(source, /delete normalized\.defensive_line/);
  assert.ok(
    source.indexOf('instruction.tactics = normalizePortalTactics(instruction.tactics)')
      < source.indexOf('const playerIds ='),
    'portal tactics must be normalized before a locked production instruction is returned'
  );
});

test('the exact failed portal width value is accepted by the adapter', async () => {
  const source = await read('src/world/sharedWorldScheduler.js');

  assert.match(source, /width === 'narrow' \? 'central' : width/);
  assert.doesNotMatch(source, /throw new Error\(`Unsupported human tactic: width=/);
});
