import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('team submission writes only columns present in manager_turn_submissions', async () => {
  const source = await read('netlify/functions/decisions.mjs');
  assert.match(source, /const \{ version: submissionVersion, \.\.\.submissionRow \} = submission/);
  assert.match(source, /body: JSON\.stringify\(submissionRow\)/);
  assert.match(source, /submission_version: submissionVersion/);
  assert.doesNotMatch(source, /body: JSON\.stringify\(submission\)/);
});
