import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('submission state guard loads before portal consumers', async () => {
  const html = await read('public/index.html');
  const guardIndex = html.indexOf('submission-state-monotonic-guard.js');
  const phase2c2bIndex = html.indexOf('phase2c2b.js');
  const formationIndex = html.indexOf('formation-board.js');

  assert.ok(guardIndex >= 0, 'monotonic guard must be loaded');
  assert.ok(guardIndex < phase2c2bIndex, 'guard must run before phase2c2b');
  assert.ok(guardIndex < formationIndex, 'guard must run before formation board');
});

test('older portal submission snapshots are stopped before consumers run', async () => {
  const source = await read('public/submission-state-monotonic-guard.js');

  assert.match(source, /let newestSubmissionTime = 0/);
  assert.match(source, /time < newestSubmissionTime/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /window\.addEventListener\(eventName, guardPortalState, true\)/);
  assert.match(source, /tbg:portal-rendered/);
  assert.match(source, /tbg:portal-refreshed/);
});

test('successful canonical saves advance the monotonic state', async () => {
  const source = await read('public/submission-state-monotonic-guard.js');

  assert.match(source, /tbg:team-submission-saved/);
  assert.match(source, /remember\(state\)/);
  assert.match(source, /window\.tbgPortalState = state/);
});
