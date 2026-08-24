import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const path of ['netlify/functions/club-claim.mjs', 'netlify/functions/alpha-admin.mjs']) {
  test(`#291 ${path} defaults to the canonical production world id`, () => {
    const source = read(path);
    assert.match(source, /process\.env\.TBG_WORLD_ID \|\| 'tbg-world-001'/);
    assert.doesNotMatch(source, /process\.env\.TBG_WORLD_ID \|\| 'tbg-world-1'/);
  });
}
