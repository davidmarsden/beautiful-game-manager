import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('saved-team rehydration observer is released after formation board startup', async () => {
  const source = await read('public/bounded-submission-rehydration.js');
  const html = await read('public/index.html');

  assert.match(source, /tbg:formation-board-ready/);
  assert.match(source, /tbg:team-sheet-override/);
  assert.match(source, /formation_board_ready/);
  assert.match(source, /rehydration_timeout/);
  assert.match(source, /8000/);
  assert.match(source, /window\.tbgSubmissionRehydrationReleased = true/);
  assert.match(source, /rehydration_release_latch/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /30000/);
  assert.match(source, /250/);
  assert.match(source, /pagehide/);
  assert.ok(html.indexOf('bounded-submission-rehydration.js') > html.indexOf('phase2c2b.js'));
  assert.ok(html.indexOf('bounded-submission-rehydration.js') < html.indexOf('formation-board.js'));
});
